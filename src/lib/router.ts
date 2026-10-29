import { useEffect, useState } from 'react';

/** Hash routes (#/path) so the app works on any static host without rewrites. */
export function useRoute(): string {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setRoute(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string) {
  location.hash = path;
}
