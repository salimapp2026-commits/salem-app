// Terms of Service — English primary (the shipping UI language), Arabic below.
// Store-submission baseline. Replace the placeholders and have counsel review
// before public launch. Critically, the medical disclaimer below is
// non-negotiable for a health-adjacent app.
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { FieldScreen, SubHeader } from '@/components/dashboard';
import { colors, fonts, space, type } from '@/theme/tokens';

const UPDATED = '2026-09-30';
const CONTACT = 'support@salem.app'; // TODO: replace with real contact

export default function Terms() {
  return (
    <FieldScreen>
      <SubHeader title="Terms of Service" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.updated}>Last updated: {UPDATED}</Text>

          <Section h="Acceptance of these terms">
            By using Salem you agree to these terms. If you do not agree, please
            do not use the app.
          </Section>

          <Section h="⚠️ Important medical disclaimer">
            Salem is not a substitute for professional medical care. The Rafiq AI
            companion provides general information only — it does not diagnose
            conditions and does not prescribe treatment. In an emergency, call
            emergency services immediately, and always consult your doctor before
            making any health decision.
          </Section>

          <Section h="Your account">
            You are responsible for keeping your sign-in details confidential and
            for all activity that takes place through your account. The
            information you provide must be accurate and kept up to date.
          </Section>

          <Section h="Acceptable use">
            You agree not to misuse the app, not to attempt to reach other
            people's data without authorization, and not to use it for any
            unlawful purpose.
          </Section>

          <Section h="Care circle">
            When you join a care circle or invite others into one, you accept
            that authorized members will be able to see data according to the
            permissions granted to them.
          </Section>

          <Section h="Choosing your role">
            You choose your role — senior, family member, or doctor — once, when
            you create your account. That choice is permanent and cannot be
            changed afterwards. To use Salem in a different role you must create
            a separate account.
          </Section>

          <Section h="Ending the service">
            You can delete your account at any time from Settings. We may suspend
            accounts that breach these terms.
          </Section>

          <Section h="Limitation of liability">
            The app is provided "as is". We accept no liability for harm arising
            from relying on the AI companion's information instead of seeking
            medical advice.
          </Section>

          <Section h="Contact">
            For any question: {CONTACT}
          </Section>

          <View style={styles.divider} />

          <Text style={styles.altTitle}>شروط الاستخدام (العربية)</Text>

          <Section h="قبول الشروط" rtl>
            باستخدامك تطبيق «سَليم» فإنك توافق على هذه الشروط. إذا لم توافق،
            يرجى عدم استخدام التطبيق.
          </Section>
          <Section h="⚠️ تنبيه طبي مهم" rtl>
            سَليم ليس بديلاً عن الرعاية الطبية المتخصصة. المساعد الذكي «رفيق»
            يقدّم معلومات عامة فقط ولا يشخّص الأمراض ولا يصف العلاج. في حالات
            الطوارئ اتصل بالإسعاف فوراً، واستشر طبيبك دائماً قبل أي قرار صحي.
          </Section>
          <Section h="استخدام الحساب" rtl>
            أنت مسؤول عن الحفاظ على سرية بيانات دخولك وعن كل نشاط يتم عبر حسابك.
            يجب أن تكون المعلومات التي تقدّمها صحيحة ومحدّثة.
          </Section>
          <Section h="السلوك المقبول" rtl>
            تتعهد بعدم إساءة استخدام التطبيق أو محاولة الوصول لبيانات الآخرين
            دون صلاحية، أو استخدامه لأي غرض غير قانوني.
          </Section>
          <Section h="دائرة الرعاية" rtl>
            عند الانضمام لدائرة رعاية أو دعوة آخرين إليها، فإنك تقرّ بأن الأعضاء
            المصرّح لهم سيتمكنون من رؤية البيانات حسب الصلاحيات الممنوحة لهم.
          </Section>
          <Section h="اختيار نوع الحساب" rtl>
            تختار نوع حسابك — كبير سن أو فرد عائلة أو طبيب — مرة واحدة فقط عند
            إنشاء الحساب، ولا يمكن تغييره بعد ذلك. لاستخدام «سَليم» بنوع مختلف
            يجب إنشاء حساب جديد.
          </Section>
          <Section h="إنهاء الخدمة" rtl>
            يمكنك حذف حسابك في أي وقت من الإعدادات. يحق لنا تعليق الحسابات التي
            تخالف هذه الشروط.
          </Section>
          <Section h="حدود المسؤولية" rtl>
            يُقدّم التطبيق «كما هو». لا نتحمل المسؤولية عن أي ضرر ناتج عن
            الاعتماد على معلومات المساعد الذكي بدلاً من الاستشارة الطبية.
          </Section>
          <Section h="التواصل" rtl>
            لأي استفسار: {CONTACT}
          </Section>
        </View>
      </ScrollView>
    </FieldScreen>
  );
}

function Section({
  h,
  children,
  rtl,
}: {
  h: string;
  children: React.ReactNode;
  rtl?: boolean;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.h, rtl && styles.rtl]}>{h}</Text>
      <Text style={[styles.p, rtl && styles.rtl]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.m, paddingBottom: space.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: space.l,
    gap: space.l,
  },
  updated: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  section: { gap: space.s },
  h: { ...type.subtitle, color: colors.textPrimary, textAlign: 'left' },
  p: { ...type.body, color: colors.textPrimary, textAlign: 'left', lineHeight: 26 },
  // The Arabic half keeps its own direction and typeface while the app ships
  // LTR — Inter has no Arabic glyphs.
  rtl: { textAlign: 'right', writingDirection: 'rtl', fontFamily: fonts.arabicBody },
  divider: { height: 1, backgroundColor: colors.divider },
  altTitle: { ...type.subtitle, color: colors.textSecondary, textAlign: 'right' },
});
