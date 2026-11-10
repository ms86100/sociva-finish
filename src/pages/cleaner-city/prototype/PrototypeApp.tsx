import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PrototypeProvider, useProto } from './store';
import { PrototypeShell } from './Shell';
import { OnboardingScreen } from './screens/Onboarding';
import { HomeScreen } from './screens/Home';
import { DiscoverScreen } from './screens/Discover';
import { MyRidesScreen } from './screens/MyRides';
import { ProfileScreen } from './screens/Profile';
import { RideMissionScreen } from './screens/RideMission';

const BASE = '/cleaner-city/prototype';

function pathAfterBase(pathname: string): string {
  if (!pathname.startsWith(BASE)) return '';
  return pathname.slice(BASE.length).replace(/^\//, '');
}

function PrototypeRouter() {
  const { state } = useProto();
  const location = useLocation();
  const navigate = useNavigate();
  const rest = pathAfterBase(location.pathname);
  const segments = rest ? rest.split('/').filter(Boolean) : [];

  useEffect(() => {
    if (!state.onboardingComplete && segments[0] !== 'onboarding') {
      navigate(`${BASE}/onboarding`, { replace: true });
      return;
    }
    if (state.onboardingComplete && segments[0] === 'onboarding') {
      navigate(BASE, { replace: true });
    }
  }, [state.onboardingComplete, segments, navigate]);

  if (!state.onboardingComplete) {
    return <OnboardingScreen />;
  }

  let body: ReactNode = <HomeScreen />;
  if (segments[0] === 'discover') body = <DiscoverScreen />;
  else if (segments[0] === 'rides') body = <MyRidesScreen />;
  else if (segments[0] === 'ride' && segments[1]) body = <RideMissionScreen rideIdProp={segments[1]} />;
  else if (segments[0] === 'profile') body = <ProfileScreen sectionProp={segments[1]} />;

  return <PrototypeShell>{body}</PrototypeShell>;
}

export default function CleanerCityPrototypeApp() {
  return (
    <PrototypeProvider>
      <PrototypeRouter />
    </PrototypeProvider>
  );
}
