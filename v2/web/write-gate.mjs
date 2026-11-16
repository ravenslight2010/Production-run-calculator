export function canWriteRunState({ authenticated, online, serverStateConfirmed }) {
  return authenticated === true && online === true && serverStateConfirmed === true;
}
