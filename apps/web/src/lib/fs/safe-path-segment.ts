/**
 * True for a single file/directory name made of safe characters: no path
 * separators, not `.` or `..`. Use before joining user input into a path.
 */
export function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..';
}
