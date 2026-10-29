import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';

/** Page frame for the account screens: top bar plus a centred column. */
export function Shell({ children, signedIn = false, wide = false }: { children: ReactNode; signedIn?: boolean; wide?: boolean }) {
  return (
    <div className="app">
      <header className="toolbar">
        <div className="group">
          <a className="brand" href="#/">MyPDF</a>
          <a className="button" href="#/">Sign myself</a>
          {signedIn && <a className="button" href="#/documents">My documents</a>}
        </div>
        {signedIn && (
          <div className="group push-right">
            <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
          </div>
        )}
      </header>
      <main className={`content ${wide ? 'wide' : ''}`}>{children}</main>
    </div>
  );
}

export function statusLabel(status: string): string {
  return (
    {
      draft: 'Draft',
      sent: 'Waiting for signatures',
      completed: 'Completed',
      declined: 'Declined',
      voided: 'Cancelled',
      pending: 'Not sent yet',
      viewed: 'Opened',
      signed: 'Signed',
    } as Record<string, string>
  )[status] ?? status;
}

export function formatDate(s: string | null | undefined): string {
  return s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}
