export function isDefaultProjectDirectory(directory: string) {
  return directory.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) === "Default Project"
}
