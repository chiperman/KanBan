use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use longbridge::{
    oauth::OAuthBuilder, quote::QuoteContext, trade::TradeContext, Config, PortfolioContext,
};
use longbridge_oauth::{OAuthError, OAuthResult, StoredToken, TokenStorage};
use napi::bindgen_prelude::{Error as NapiError, Result as NapiResult, Status};
use napi_derive::napi;
use oauth2::{
    basic::BasicClient, reqwest::async_http_client, AuthUrl, AuthorizationCode, ClientId,
    CsrfToken, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = "com.xiaox.kanban.longbridge";
const AUTHORIZATION_URL_WAIT: Duration = Duration::from_secs(3);

#[derive(Deserialize, Serialize)]
struct KeychainToken {
    client_id: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
}

impl From<StoredToken> for KeychainToken {
    fn from(token: StoredToken) -> Self {
        Self {
            client_id: token.client_id,
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_at: token.expires_at,
        }
    }
}

impl From<KeychainToken> for StoredToken {
    fn from(token: KeychainToken) -> Self {
        Self {
            client_id: token.client_id,
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_at: token.expires_at,
        }
    }
}

/// OAuth 凭证的 macOS Keychain 后端。
///
/// 该模块只保存完整 OAuth 凭证，绝不回退到 SDK 的默认 Token 文件。
#[derive(Clone)]
pub struct KeychainTokenStorage {
    client_id: String,
}

impl KeychainTokenStorage {
    pub fn new(client_id: impl Into<String>) -> Self {
        Self {
            client_id: client_id.into(),
        }
    }

    pub fn service_name(&self) -> &'static str {
        KEYCHAIN_SERVICE
    }

    pub fn account_name(&self) -> &str {
        &self.client_id
    }

    pub fn has_token(&self) -> bool {
        self.load_checked(&self.client_id).ok().flatten().is_some()
    }

    pub fn require_token(&self) -> OAuthResult<()> {
        self.load_checked(&self.client_id)?.ok_or_else(|| {
            OAuthError::Other("长桥尚未在 macOS Keychain 完成授权".to_string())
        })?;
        Ok(())
    }

    fn entry(&self, client_id: &str) -> OAuthResult<keyring::Entry> {
        keyring::Entry::new(KEYCHAIN_SERVICE, client_id)
            .map_err(|error| OAuthError::Other(format!("无法访问 macOS Keychain：{error}")))
    }

    fn load_checked(&self, client_id: &str) -> OAuthResult<Option<StoredToken>> {
        let encoded = match self.entry(client_id)?.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(error) => {
                return Err(OAuthError::Other(format!(
                    "无法读取 macOS Keychain 中的长桥凭证：{error}"
                )));
            }
        };
        let token: KeychainToken = serde_json::from_str(&encoded).map_err(|error| {
            OAuthError::Other(format!("macOS Keychain 中的长桥凭证格式无效：{error}"))
        })?;
        if token.client_id != client_id {
            return Err(OAuthError::Other(
                "macOS Keychain 中的长桥凭证 client_id 不匹配".to_string(),
            ));
        }
        Ok(Some(token.into()))
    }

    pub fn clear(&self) -> OAuthResult<()> {
        match self.entry(&self.client_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(OAuthError::Other(format!(
                "无法删除 macOS Keychain 中的长桥凭证：{error}"
            ))),
        }
    }
}

impl TokenStorage for KeychainTokenStorage {
    fn load(&self, client_id: &str) -> Option<StoredToken> {
        self.load_checked(client_id).ok().flatten()
    }

    fn save(&self, token: &StoredToken) -> OAuthResult<()> {
        if token.client_id != self.client_id {
            return Err(OAuthError::Other(
                "长桥 OAuth client_id 与 Keychain 存储不匹配".to_string(),
            ));
        }
        let encoded = serde_json::to_string(&KeychainToken::from(token.clone())).map_err(|error| {
            OAuthError::Other(format!("无法序列化长桥 OAuth 凭证：{error}"))
        })?;
        self.entry(&token.client_id)?
            .set_password(&encoded)
            .map_err(|error| OAuthError::Other(format!("无法写入 macOS Keychain：{error}")))?;
        self.require_token()?;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthorizationStart {
    status: &'static str,
    authorization_url: Option<String>,
}

#[derive(Clone)]
enum AuthorizationState {
    Authorizing { authorization_url: String },
    Authorized,
    Failed { message: String },
}

static AUTHORIZATION_STATES: LazyLock<Mutex<HashMap<String, AuthorizationState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone)]
struct WebAuthorizationSession {
    state: String,
    code_verifier: String,
    redirect_uri: String,
}

static WEB_AUTHORIZATION_SESSIONS: LazyLock<Mutex<HashMap<String, WebAuthorizationSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn napi_error(message: impl Into<String>) -> NapiError {
    NapiError::new(Status::GenericFailure, message.into())
}

fn state_for(client_id: &str) -> Option<AuthorizationState> {
    AUTHORIZATION_STATES
        .lock()
        .expect("authorization state lock")
        .get(client_id)
        .cloned()
}

fn save_state(client_id: String, state: AuthorizationState) {
    AUTHORIZATION_STATES
        .lock()
        .expect("authorization state lock")
        .insert(client_id, state);
}

fn serialize(value: impl Serialize) -> NapiResult<String> {
    serde_json::to_string(&value).map_err(|error| napi_error(format!("无法编码长桥 SDK 响应：{error}")))
}

fn web_oauth_client(client_id: &str, redirect_uri: &str) -> NapiResult<BasicClient> {
    let redirect_uri = RedirectUrl::new(redirect_uri.to_string())
        .map_err(|error| napi_error(format!("长桥 redirect_uri 无效：{error}")))?;
    Ok(BasicClient::new(
        ClientId::new(client_id.to_string()),
        None,
        AuthUrl::new("https://openapi.longbridge.com/oauth2/authorize".to_string())
            .expect("static Longbridge authorization URL"),
        Some(
            TokenUrl::new("https://openapi.longbridge.com/oauth2/token".to_string())
                .expect("static Longbridge token URL"),
        ),
    )
    .set_redirect_uri(redirect_uri))
}

fn validate_account_read_scope<T>(token: &T) -> NapiResult<()>
where
    T: TokenResponse<oauth2::basic::BasicTokenType>,
{
    let scopes = token
        .scopes()
        .ok_or_else(|| napi_error("长桥未返回 OAuth scope，无法证明授权为只读"))?;
    let actual: Vec<&str> = scopes.iter().map(|scope| scope.as_ref()).collect();
    if actual.len() != 1 || !matches!(actual.first().copied(), Some("6" | "account.read")) {
        return Err(napi_error(format!(
            "长桥授权范围不是仅账户读取（实际：{}）",
            actual.join(" ")
        )));
    }
    Ok(())
}

async fn load_oauth(client_id: String, callback_port: u16) -> Result<longbridge::oauth::OAuth, String> {
    let storage = KeychainTokenStorage::new(client_id.clone());
    storage.require_token().map_err(|error| error.to_string())?;
    let status_client_id = client_id.clone();
    OAuthBuilder::new(client_id)
        .callback_port(callback_port)
        .token_storage(storage)
        .build(|url| {
            save_state(
                status_client_id.clone(),
                AuthorizationState::Authorizing {
                    authorization_url: url.to_string(),
                },
            );
        })
        .await
        .map_err(|error| format!("长桥 OAuth 读取失败：{error}"))
}

/// 开始官方 SDK OAuth。SDK 的回调监听仅绑定 127.0.0.1，令牌只写 macOS Keychain。
#[napi]
pub fn begin_authorization(client_id: String, callback_port: u32) -> NapiResult<String> {
    let callback_port = u16::try_from(callback_port)
        .map_err(|_| napi_error("长桥 OAuth 回调端口无效"))?;
    if client_id.trim().is_empty() {
        return Err(napi_error("长桥 OAuth client_id 不能为空"));
    }
    if let Some(AuthorizationState::Authorizing { authorization_url }) = state_for(&client_id) {
        return serialize(AuthorizationStart {
            status: "authorizing",
            authorization_url: Some(authorization_url),
        });
    }

    let (url_sender, url_receiver) = std::sync::mpsc::sync_channel(1);
    let task_client_id = client_id.clone();
    std::thread::spawn(move || {
        let storage = KeychainTokenStorage::new(task_client_id.clone());
        let result = longbridge::runtime_handle().block_on(
            OAuthBuilder::new(task_client_id.clone())
                .callback_port(callback_port)
                .token_storage(storage)
                .build(|url| {
                    let authorization_url = url.to_string();
                    save_state(
                        task_client_id.clone(),
                        AuthorizationState::Authorizing {
                            authorization_url: authorization_url.clone(),
                        },
                    );
                    let _ = url_sender.send(authorization_url);
                }),
        );
        match result {
            Ok(_) => save_state(task_client_id, AuthorizationState::Authorized),
            Err(error) => save_state(
                task_client_id,
                AuthorizationState::Failed {
                    message: format!("长桥 OAuth 授权失败：{error}"),
                },
            ),
        }
    });

    match url_receiver.recv_timeout(AUTHORIZATION_URL_WAIT) {
        Ok(authorization_url) => serialize(AuthorizationStart {
            status: "authorizing",
            authorization_url: Some(authorization_url),
        }),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => serialize(AuthorizationStart {
            status: "authorizing",
            authorization_url: None,
        }),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => match state_for(&client_id) {
            Some(AuthorizationState::Authorized) => serialize(AuthorizationStart {
                status: "authorized",
                authorization_url: None,
            }),
            Some(AuthorizationState::Failed { message }) => Err(napi_error(message)),
            _ => Err(napi_error("长桥 OAuth 未能启动")),
        },
    }
}

/// 读取当前 OAuth 授权的状态；不返回 Token 或其他凭证正文。
#[napi]
pub fn authorization_status(client_id: String) -> NapiResult<String> {
    let result = match state_for(&client_id) {
        Some(AuthorizationState::Authorizing { authorization_url }) => AuthorizationStart {
            status: "authorizing",
            authorization_url: Some(authorization_url),
        },
        Some(AuthorizationState::Authorized) => AuthorizationStart {
            status: "authorized",
            authorization_url: None,
        },
        Some(AuthorizationState::Failed { message }) => return Err(napi_error(message)),
        None if KeychainTokenStorage::new(client_id).has_token() => AuthorizationStart {
            status: "authorized",
            authorization_url: None,
        },
        None => AuthorizationStart {
            status: "idle",
            authorization_url: None,
        },
    };
    serialize(result)
}

/// 生成网页回调 OAuth URL。PKCE verifier 只在原生进程内存保留，绝不返回 Node。
#[napi]
pub fn begin_browser_authorization(client_id: String, redirect_uri: String) -> NapiResult<String> {
    if client_id.trim().is_empty() {
        return Err(napi_error("长桥 OAuth client_id 不能为空"));
    }
    let client = web_oauth_client(&client_id, &redirect_uri)?;
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let (authorization_url, csrf_token) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new("6".to_string()))
        .set_pkce_challenge(challenge)
        .url();
    let state = csrf_token.secret().to_string();
    WEB_AUTHORIZATION_SESSIONS
        .lock()
        .expect("web authorization session lock")
        .insert(
            state.clone(),
            WebAuthorizationSession {
                state: state.clone(),
                code_verifier: verifier.secret().to_string(),
                redirect_uri,
            },
        );
    serialize(serde_json::json!({
        "authorizationUrl": authorization_url.to_string(),
        "state": state,
    }))
}

/// 校验网页回调并在原生层兑换 code；得到的 Token 只写入 macOS Keychain。
#[napi]
pub fn complete_browser_authorization(
    client_id: String,
    state: String,
    code: String,
    redirect_uri: String,
) -> String {
    match complete_browser_authorization_inner(client_id, state, code, redirect_uri) {
        Ok(()) => serde_json::json!({ "status": "authorized" }).to_string(),
        Err(error) => serde_json::json!({
            "status": "error",
            "message": error.to_string(),
        })
        .to_string(),
    }
}

fn complete_browser_authorization_inner(
    client_id: String,
    state: String,
    code: String,
    redirect_uri: String,
) -> NapiResult<()> {
    let session = WEB_AUTHORIZATION_SESSIONS
        .lock()
        .expect("web authorization session lock")
        .remove(&state)
        .ok_or_else(|| napi_error("长桥授权校验失败，请重新开始"))?;
    if session.state != state || session.redirect_uri != redirect_uri {
        return Err(napi_error("长桥授权回调地址校验失败"));
    }
    let client = web_oauth_client(&client_id, &redirect_uri)?;
    let token = longbridge::runtime_handle()
        .block_on(
            client
                .exchange_code(AuthorizationCode::new(code))
                .set_pkce_verifier(PkceCodeVerifier::new(session.code_verifier))
                .request_async(async_http_client),
        )
        .map_err(|error| napi_error(format!("长桥授权兑换失败：{error}")))?;
    validate_account_read_scope(&token)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| napi_error(format!("系统时间无效：{error}")))?
        .as_secs();
    KeychainTokenStorage::new(client_id.clone())
        .save(&StoredToken {
            client_id,
            access_token: token.access_token().secret().to_string(),
            refresh_token: token.refresh_token().map(|value| value.secret().to_string()),
            expires_at: now + token.expires_in().map_or(3600, |value| value.as_secs()),
        })
        .map_err(|error| napi_error(error.to_string()))?;
    Ok(())
}

/// 读取账户与持仓。返回的是 SDK 已解析的响应，绝不包含 OAuth Token。
#[napi]
pub async fn read_assets(
    client_id: String,
    callback_port: u32,
    reporting_currency: String,
) -> NapiResult<String> {
    let callback_port = u16::try_from(callback_port)
        .map_err(|_| napi_error("长桥 OAuth 回调端口无效"))?;
    let oauth = load_oauth(client_id, callback_port)
        .await
        .map_err(napi_error)?;
    let config = std::sync::Arc::new(Config::from_oauth(oauth));
    let (trade, _) = TradeContext::new(config.clone());
    let portfolio = PortfolioContext::new(config);
    let (account, stock, fund, exchange_rates) = tokio::try_join!(
        trade.account_balance(Some(reporting_currency.as_str())),
        trade.stock_positions(None),
        trade.fund_positions(None),
        portfolio.exchange_rate(),
    )
    .map_err(|error| napi_error(format!("长桥账户或持仓读取失败：{error}")))?;
    serialize(serde_json::json!({
        "accountPage": { "data": { "list": account } },
        "stockPage": { "data": { "list": stock.channels } },
        "fundPage": { "data": { "list": fund.channels } },
        "exchangeRates": exchange_rates.exchanges,
    }))
}

/// 读取指定标的的最新报价。只暴露标的、现价、昨收和时间。
#[napi]
pub async fn read_quotes(client_id: String, callback_port: u32, symbols: Vec<String>) -> NapiResult<String> {
    let callback_port = u16::try_from(callback_port)
        .map_err(|_| napi_error("长桥 OAuth 回调端口无效"))?;
    let symbols: Vec<String> = symbols
        .into_iter()
        .filter(|symbol| !symbol.trim().is_empty())
        .collect();
    if symbols.is_empty() {
        return serialize(Vec::<serde_json::Value>::new());
    }
    let oauth = load_oauth(client_id, callback_port)
        .await
        .map_err(napi_error)?;
    let config = std::sync::Arc::new(Config::from_oauth(oauth));
    let (quote, _) = QuoteContext::new(config);
    let quotes = quote
        .quote(symbols)
        .await
        .map_err(|error| napi_error(format!("长桥报价读取失败：{error}")))?;
    let values: Vec<serde_json::Value> = quotes
        .into_iter()
        .map(|quote| {
            serde_json::json!({
                "symbol": quote.symbol,
                "lastDone": quote.last_done.to_string(),
                "prevClose": quote.prev_close.to_string(),
                "timestamp": quote.timestamp.unix_timestamp(),
            })
        })
        .collect();
    serialize(values)
}

/// 删除当前 OAuth client 的长桥 Keychain 凭证，用于用户主动断开连接。
#[napi]
pub fn forget_authorization(client_id: String) -> NapiResult<()> {
    KeychainTokenStorage::new(client_id)
        .clear()
        .map_err(|error| napi_error(error.to_string()))
}

#[napi]
pub fn keychain_service_name() -> String {
    KEYCHAIN_SERVICE.to_string()
}

#[cfg(test)]
mod tests {
    use super::KeychainTokenStorage;

    #[test]
    fn stores_each_oauth_client_under_the_kanban_keychain_service() {
        let storage = KeychainTokenStorage::new("client-123");

        assert_eq!(storage.service_name(), "com.xiaox.kanban.longbridge");
        assert_eq!(storage.account_name(), "client-123");
    }
}
