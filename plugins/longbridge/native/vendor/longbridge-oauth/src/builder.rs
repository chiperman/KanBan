use std::{sync::Arc, time::Duration};

use crate::{
    client::{DEFAULT_CALLBACK_PORT, OAuth, OAuthInner},
    error::OAuthResult,
    storage::{TokenStorage, default_storage},
};

/// Builder for constructing an [`OAuth`] client.
///
/// `client_id` is the only required field.  By default tokens are persisted at
/// `~/.longbridge/openapi/tokens/<client_id>`; supply a custom
/// [`TokenStorage`] via [`token_storage`](OAuthBuilder::token_storage) to
/// change this.
pub struct OAuthBuilder {
    /// OAuth 2.0 client ID
    pub(crate) client_id: String,
    /// Local port for the callback server
    pub(crate) callback_port: u16,
    /// Token persistence backend
    pub(crate) storage: Arc<dyn TokenStorage>,
    /// Requested OAuth permission. KanBan keeps this to the account read scope.
    pub(crate) scope: String,
    refresh_before_expiry: Duration,
}

impl OAuthBuilder {
    /// Create a new builder with the given client ID.
    pub fn new(client_id: impl Into<String>) -> Self {
        Self {
            client_id: client_id.into(),
            callback_port: DEFAULT_CALLBACK_PORT,
            storage: default_storage(),
            scope: "6".to_string(),
            refresh_before_expiry: Duration::from_secs(300),
        }
    }

    /// Set the local callback server port (default: `60355`).
    #[must_use]
    pub fn callback_port(mut self, port: u16) -> Self {
        self.callback_port = port;
        self
    }

    /// Override the token storage backend.
    ///
    /// The default is [`FileTokenStorage`](crate::FileTokenStorage), which
    /// writes tokens to `~/.longbridge/openapi/tokens/<client_id>`.  Pass a
    /// custom implementation to store tokens elsewhere (e.g. OS keychain).
    ///
    /// # Examples
    ///
    /// ```no_run
    /// use longbridge_oauth::{FileTokenStorage, OAuthBuilder};
    ///
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let oauth = OAuthBuilder::new("your-client-id")
    ///     .token_storage(FileTokenStorage)
    ///     .build(|url| println!("Visit: {url}"))
    ///     .await?;
    /// # Ok(())
    /// # }
    /// ```
    #[must_use]
    pub fn token_storage(mut self, storage: impl TokenStorage) -> Self {
        self.storage = Arc::new(storage);
        self
    }

    /// Override the OAuth scope requested from Longbridge.
    ///
    /// This private SDK fork exposes the setting so the host application can
    /// enforce least privilege instead of accepting the SDK's former empty
    /// scope (which lets the authorization server choose broader defaults).
    #[must_use]
    pub fn scope(mut self, scope: impl Into<String>) -> Self {
        self.scope = scope.into();
        self
    }

    /// Refresh a stored token within this window when building the client.
    /// Ordinary access-token requests retain their five-minute window.
    #[must_use]
    pub fn refresh_before_expiry(mut self, window: Duration) -> Self {
        self.refresh_before_expiry = window;
        self
    }

    /// Synchronously build the [`OAuth`] client.
    ///
    /// This is the blocking equivalent of [`build`](OAuthBuilder::build).  It
    /// spins up a temporary single-threaded Tokio runtime internally so it can
    /// be called from a non-async context such as a blocking application or a
    /// doc-test `fn main()`.
    ///
    /// First tries to load an existing token via the configured storage
    /// backend.  If no valid token is found the full browser-based
    /// authorization flow is started and `open_url` is called with the
    /// authorization URL.  The resulting token is persisted for future use.
    ///
    /// # Examples
    ///
    /// ```no_run
    /// use longbridge_oauth::OAuthBuilder;
    ///
    /// fn main() -> Result<(), Box<dyn std::error::Error>> {
    ///     let oauth =
    ///         OAuthBuilder::new("your-client-id").build_blocking(|url| println!("Visit: {url}"))?;
    ///     println!("client_id: {}", oauth.client_id());
    ///     Ok(())
    /// }
    /// ```
    #[cfg(feature = "blocking")]
    pub fn build_blocking(self, open_url: impl Fn(&str)) -> OAuthResult<OAuth> {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|e| crate::error::OAuthError::Other(e.to_string()))?
            .block_on(self.build(open_url))
    }

    /// Asynchronously build the [`OAuth`] client.
    ///
    /// First tries to load an existing token via the configured storage
    /// backend.  If no valid token is found the full browser-based
    /// authorization flow is started and `open_url` is called with the
    /// authorization URL.  The resulting token is persisted for future use.
    pub async fn build(self, open_url: impl Fn(&str)) -> OAuthResult<OAuth> {
        self.build_inner(Some(open_url)).await
    }

    /// Load or refresh a stored token without ever starting browser authorization.
    pub async fn build_cached(self) -> OAuthResult<OAuth> {
        self.build_inner(None::<fn(&str)>).await
    }

    async fn build_inner(self, open_url: Option<impl Fn(&str)>) -> OAuthResult<OAuth> {
        let storage = self.storage;

        let inner = Arc::new(OAuthInner {
            client_id: self.client_id.clone(),
            callback_port: self.callback_port,
            storage: Arc::clone(&storage),
            scope: self.scope.clone(),
            token: tokio::sync::Mutex::new(None),
        });
        let oauth = OAuth(inner);

        let loaded = storage
            .load(&self.client_id)
            .map(crate::token::OAuthToken::from);

        let token = match loaded {
            Some(t) if !t.expires_within(self.refresh_before_expiry) => {
                tracing::debug!(client_id = %self.client_id, expires_at = t.expires_at, "loaded valid token from storage");
                t
            }
            Some(t) => {
                tracing::debug!(
                    client_id = %self.client_id,
                    "loaded expired or expiring-soon token, attempting refresh"
                );
                match oauth.refresh_token(&t).await {
                    Ok(refreshed) => {
                        storage.save(&refreshed.clone().into())?;
                        refreshed
                    }
                    Err(e) => {
                        // KanBan uses its registered browser callback for all interactive
                        // authorizations. Never silently fall back to the SDK loopback
                        // callback here: it may not be registered for this OAuth client.
                        tracing::warn!(error = %e, "token refresh failed; explicit browser reauthorization required");
                        return Err(e);
                    }
                }
            }
            None => {
                let open_url = open_url.ok_or(crate::error::OAuthError::NoTokenAvailable)?;
                tracing::debug!("no cached token found, starting authorization flow");
                let new_token = oauth.authorize_inner(open_url).await?;
                storage.save(&new_token.clone().into())?;
                new_token
            }
        };

        *oauth.0.token.lock().await = Some(token);
        Ok(oauth)
    }
}
