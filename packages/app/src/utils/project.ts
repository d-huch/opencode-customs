export const CHAT_WORKSPACE_DIRECTORY = "OpenCode Customs Chat"

function directoryName(directory: string) {
  return directory.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1)
}

export function isDefaultProjectDirectory(directory: string) {
  return directoryName(directory) === "Default Project"
}

export function isChatWorkspaceDirectory(directory: string) {
  return directoryName(directory) === CHAT_WORKSPACE_DIRECTORY
}

export function isNonRepositoryDirectory(directory: string) {
  return isDefaultProjectDirectory(directory) || isChatWorkspaceDirectory(directory)
}
