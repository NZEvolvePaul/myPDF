export interface RoutedRecipient {
  id: string;
  routing_order: number;
  status: 'pending' | 'sent' | 'viewed' | 'signed' | 'declined';
}

/**
 * Recipients whose turn it is: everyone in the lowest routing order that
 * still has someone who hasn't signed. Recipients sharing an order sign in
 * parallel. Returns an empty list when everyone has signed.
 */
export function currentRound<T extends RoutedRecipient>(recipients: T[]): T[] {
  const open = recipients.filter((r) => r.status !== 'signed');
  if (open.length === 0) return [];
  const order = Math.min(...open.map((r) => r.routing_order));
  return open.filter((r) => r.routing_order === order);
}

/** Recipients in the current round who haven't been emailed yet. */
export function toNotify<T extends RoutedRecipient>(recipients: T[]): T[] {
  return currentRound(recipients).filter((r) => r.status === 'pending');
}

export function allSigned(recipients: RoutedRecipient[]): boolean {
  return recipients.length > 0 && recipients.every((r) => r.status === 'signed');
}
