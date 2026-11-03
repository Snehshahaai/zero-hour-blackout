import { useCallback, useEffect, useState } from 'react';

export const NAV_ROUTES = ['home', 'play', 'operations', 'loadout', 'profile', 'settings'] as const;
export type NavRoute = (typeof NAV_ROUTES)[number];
/** Routes reachable by hash. `sandbox` is full-screen and not in the main navigation. */
export const ROUTES = [...NAV_ROUTES, 'sandbox'] as const;
export type Route = (typeof ROUTES)[number];

function parse(hash: string): Route {
  const name = hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'home';
}

/** Tiny hash router: avoids a routing dependency until we need nested/param routes. */
export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((r: Route) => {
    window.location.hash = `/${r}`;
  }, []);
  return [route, navigate];
}
