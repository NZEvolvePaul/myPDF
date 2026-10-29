import { useRoute } from './lib/router';
import { LocalSign } from './pages/LocalSign';
import { Documents } from './pages/Documents';
import { NewDocument } from './pages/NewDocument';
import { DocumentDetail } from './pages/DocumentDetail';
import { SignPage } from './pages/SignPage';
import { RequireLogin } from './pages/Login';

export default function App() {
  const route = useRoute();
  const parts = route.split('/').filter(Boolean);

  if (parts[0] === 'sign' && parts[1]) return <SignPage token={parts[1]} />;
  if (parts[0] === 'documents') {
    return (
      <RequireLogin>
        {parts[1] === 'new' ? <NewDocument /> : parts[1] ? <DocumentDetail id={parts[1]} /> : <Documents />}
      </RequireLogin>
    );
  }
  return <LocalSign />;
}
