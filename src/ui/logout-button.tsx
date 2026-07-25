"use client";

/** 所有者退出登录：销毁服务端会话并重新加载，敏感内容立即恢复为受限卡片。 */
export function LogoutButton() {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <button type="button" className="logout-button" onClick={logout}>
      退出登录
    </button>
  );
}
