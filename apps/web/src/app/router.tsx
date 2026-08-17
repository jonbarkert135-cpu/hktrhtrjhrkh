import { lazy, Suspense, type ReactElement } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import { Skeleton } from '@nexus/ui';
import { useSession } from '../lib/auth';
import { Shell } from './shell/Shell';

const LoginPage = lazy(() => import('./auth/LoginPage'));
const SignupPage = lazy(() => import('./auth/SignupPage'));
const ProjectPage = lazy(() => import('./pages/ProjectPage'));
const BoardPage = lazy(() => import('./pages/BoardPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function RouteFallback() {
  return (
    <div className="nx-stack" aria-busy="true" aria-label="Loading">
      <Skeleton height="lg" />
      <Skeleton height="lg" />
      <Skeleton height="lg" />
    </div>
  );
}

/** Renders the shell skeleton while the session resolves: no flash of unauthenticated UI. */
function RequireAuth({ children }: { children: ReactElement }) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <Shell loading>{null}</Shell>;
  if (!session.data) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return children;
}

/** Already signed in on an auth route → go where the user was headed. */
function RedirectIfAuthed({ children }: { children: ReactElement }) {
  const session = useSession();
  const [params] = useSearchParams();

  if (session.isPending) return <RouteFallback />;
  if (session.data) {
    const next = params.get('next');
    return <Navigate to={next && next.startsWith('/') ? next : '/'} replace />;
  }
  return children;
}

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuthed>
                <LoginPage />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/signup"
            element={
              <RedirectIfAuthed>
                <SignupPage />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Shell>
                  <BoardPage />
                </Shell>
              </RequireAuth>
            }
          />
          <Route
            path="/p/:projectId"
            element={
              <RequireAuth>
                <Shell>
                  <ProjectPage />
                </Shell>
              </RequireAuth>
            }
          />
          <Route
            path="/b/:boardId"
            element={
              <RequireAuth>
                <Shell>
                  <BoardPage />
                </Shell>
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <Shell>
                  <SettingsPage />
                </Shell>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
