// Ported screens, by their Expo-app route. A route missing here opens the
// "still on the old app" placeholder (router.tsx). Screens under the
// (elder) / (family) / (doctor) groups are wrapped in RoleGate, as the Expo
// group layouts did. Keep docs/NATIVE_SCREEN_STATUS.md in step with this list.
import type { ComponentType } from 'react';
import { RoleGate } from '@/components/RoleGate';
import type { RoleBucket } from '@/stores/authStore';
import type { RouteName } from '@/navigation/router';

import ScreenIndex from '@/app/index';
import ScreenAuthSignIn from '@/app/(auth)/sign-in';
import ScreenAuthSignUp from '@/app/(auth)/sign-up';
import ScreenAuthPhoneSignIn from '@/app/(auth)/phone-sign-in';
import ScreenAuthCallback from '@/app/auth-callback';
import ScreenOnboardingRoleSelect from '@/app/(onboarding)/role-select';
import ScreenElder from '@/app/(elder)/index';
import ScreenElderVitals from '@/app/(elder)/vitals';
import ScreenElderReminders from '@/app/(elder)/reminders';
import ScreenElderPrescriptions from '@/app/(elder)/prescriptions';
import ScreenElderMore from '@/app/(elder)/more';
import ScreenFamilyMore from '@/app/(family)/more';
import ScreenDevPreview from '@/app/dev/preview';
import ScreenRafiq from '@/app/rafiq';
import ScreenRafiqChat from '@/app/rafiq-chat';
import ScreenMedicines from '@/app/medicines';
import ScreenMessages from '@/app/messages/index';
import ScreenMessagesId from '@/app/messages/[id]';
import ScreenFamily from '@/app/(family)/index';
import ScreenFamilyAlerts from '@/app/(family)/alerts';
import ScreenFamilyCircle from '@/app/(family)/circle';
import ScreenFamilyVisits from '@/app/(family)/visits';
import ScreenLocation from '@/app/location';
import ScreenTrendsElderId from '@/app/trends/[elderId]';
import ScreenDoctor from '@/app/(doctor)/index';
import ScreenDoctorPatientId from '@/app/(doctor)/patient/[id]';
import ScreenDoctorPrescribe from '@/app/(doctor)/prescribe';
import ScreenDoctorVisitNew from '@/app/(doctor)/visit/new';
import ScreenDoctorVisitVisitId from '@/app/(doctor)/visit/[visitId]';
import ScreenDoctorAlerts from '@/app/(doctor)/alerts';
import ScreenNotifications from '@/app/notifications';
import ScreenSettings from '@/app/settings';
import ScreenPlans from '@/app/plans';
import ScreenLegalPrivacy from '@/app/legal/privacy';
import ScreenLegalTerms from '@/app/legal/terms';
import ScreenRedeemInvite from '@/app/redeem-invite';
import ScreenLinkAdd from '@/app/link/add';
import ScreenLinkJoin from '@/app/link/join';

export const SCREENS: Partial<Record<RouteName, ComponentType>> = {
  '/': ScreenIndex,
  '/(auth)/sign-in': ScreenAuthSignIn,
  '/(auth)/sign-up': ScreenAuthSignUp,
  '/(auth)/phone-sign-in': ScreenAuthPhoneSignIn,
  '/auth-callback': ScreenAuthCallback,
  '/(onboarding)/role-select': ScreenOnboardingRoleSelect,
  '/(elder)': ScreenElder,
  '/(elder)/vitals': ScreenElderVitals,
  '/(elder)/reminders': ScreenElderReminders,
  '/(elder)/prescriptions': ScreenElderPrescriptions,
  '/(elder)/more': ScreenElderMore,
  '/(family)/more': ScreenFamilyMore,
  '/dev/preview': ScreenDevPreview,
  '/rafiq': ScreenRafiq,
  '/rafiq-chat': ScreenRafiqChat,
  '/medicines': ScreenMedicines,
  '/messages': ScreenMessages,
  '/messages/[id]': ScreenMessagesId,
  '/(family)': ScreenFamily,
  '/(family)/alerts': ScreenFamilyAlerts,
  '/(family)/circle': ScreenFamilyCircle,
  '/(family)/visits': ScreenFamilyVisits,
  '/location': ScreenLocation,
  '/trends/[elderId]': ScreenTrendsElderId,
  '/(doctor)': ScreenDoctor,
  '/(doctor)/patient/[id]': ScreenDoctorPatientId,
  '/(doctor)/prescribe': ScreenDoctorPrescribe,
  '/(doctor)/visit/new': ScreenDoctorVisitNew,
  '/(doctor)/visit/[visitId]': ScreenDoctorVisitVisitId,
  '/(doctor)/alerts': ScreenDoctorAlerts,
  '/notifications': ScreenNotifications,
  '/settings': ScreenSettings,
  '/plans': ScreenPlans,
  '/legal/privacy': ScreenLegalPrivacy,
  '/legal/terms': ScreenLegalTerms,
  '/pair': ScreenLinkAdd,
  '/link/add': ScreenLinkAdd,
  '/link/join': ScreenLinkJoin,
  '/redeem-invite': ScreenRedeemInvite,
};

function groupOf(route: string): RoleBucket | null {
  const m = route.match(/^\/\((elder|family|doctor)\)/);
  return m ? (m[1] as RoleBucket) : null;
}

/** The component to register for a route, guarded by role where needed. */
export function screenFor(route: RouteName): ComponentType {
  const C = SCREENS[route]!;
  const bucket = groupOf(route);
  if (!bucket) return C;
  const Guarded = () => (
    <RoleGate bucket={bucket}>
      <C />
    </RoleGate>
  );
  Guarded.displayName = `RoleGate(${route})`;
  return Guarded;
}
