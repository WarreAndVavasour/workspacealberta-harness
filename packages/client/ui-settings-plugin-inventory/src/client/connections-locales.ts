/** Native connection settings copy, owned in both supported locales. */
export const connectionZh = {
  title: '连接', intro: '添加 MCP 服务器，在需要时登录，并管理此终端可以使用的工具。',
  add: '添加连接', name: '名称', transport: '连接类型', remote: '远程 MCP 服务器', local: '本地 MCP 服务器',
  url: '服务器 URL', command: '命令', args: '参数（JSON 数组）', env: '凭据引用（JSON 对象）',
  envHelp: '使用已配置的凭据引用名称，不要粘贴密钥。', oauth: '使用 OAuth 登录', enabled: '启用', save: '保存', cancel: '取消',
  empty: '尚未添加连接。', edit: '编辑', disable: '停用', enable: '启用', reconnect: '重新连接', signIn: '登录', signOut: '忘记登录', remove: '移除',
  removeConfirm: '移除此连接及其本地登录信息？', loadError: '暂时无法读取连接。', operationError: '连接操作失败。',
  argsError: '参数必须是字符串组成的 JSON 数组。', envError: '凭据引用必须是字符串值组成的 JSON 对象。',
  disabled: '已停用', connecting: '正在连接…', connected: '已连接', 'sign-in-required': '需要登录', failed: '连接失败',
  signedIn: '登录完成。你可以返回原来的工作区。', callbackFailed: '登录未完成。请从连接页面重试。',
}
export type ConnectionLocaleKey = keyof typeof connectionZh
export const connectionEn = {
  title: 'Connections', intro: 'Add MCP servers, sign in when needed, and manage the tools this terminal can use.',
  add: 'Add connection', name: 'Name', transport: 'Connection type', remote: 'Remote MCP server', local: 'Local MCP server',
  url: 'Server URL', command: 'Command', args: 'Arguments (JSON array)', env: 'Credential references (JSON object)',
  envHelp: 'Use configured credential reference names. Do not paste secrets.', oauth: 'Sign in with OAuth', enabled: 'Enabled', save: 'Save', cancel: 'Cancel',
  empty: 'No connections added yet.', edit: 'Edit', disable: 'Disable', enable: 'Enable', reconnect: 'Reconnect', signIn: 'Sign in', signOut: 'Forget sign-in', remove: 'Remove',
  removeConfirm: 'Remove this connection and its local sign-in?', loadError: 'Connections are temporarily unavailable.', operationError: 'The connection operation failed.',
  argsError: 'Arguments must be a JSON array of strings.', envError: 'Credential references must be a JSON object with string values.',
  disabled: 'Disabled', connecting: 'Connecting…', connected: 'Connected', 'sign-in-required': 'Sign-in required', failed: 'Connection failed',
  signedIn: 'Sign-in complete. You can return to your original workspace.', callbackFailed: 'Sign-in was not completed. Try again from Connections.',
} satisfies Record<ConnectionLocaleKey, string>
