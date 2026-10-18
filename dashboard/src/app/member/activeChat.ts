/** The member chat open on screen, so a notification about it doesn't pop up on top of it. */
let openChatId: string | null = null;
export function setOpenChat(id: string | null) {
  openChatId = id;
}
export function openChat(): string | null {
  return openChatId;
}
