// Privacy Policy — English primary (the shipping UI language), Arabic below.
// Store-submission requirement (Apple/Google) + PDPL/GDPR.
//
// This is a plain-language baseline; have it reviewed by counsel before public
// launch and replace the placeholders (company legal name, contact email,
// governing jurisdiction).
//
// Kept in step with the product: in-app voice calls and family messaging were
// removed from Salem, so this policy must not claim we operate or collect
// them. Rafiq hands off to the phone's own dialer / SMS app, which means the
// call or message itself never reaches Salem.
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { FieldScreen, SubHeader } from '@/components/dashboard';
import { colors, fonts, space, type } from '@/theme/tokens';

const UPDATED = '2026-09-30';
const CONTACT = 'privacy@salem.app'; // TODO: replace with real contact

export default function PrivacyPolicy() {
  return (
    <FieldScreen>
      <SubHeader title="Privacy Policy" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.updated}>Last updated: {UPDATED}</Text>

          <Section h="Introduction">
            Salem is an elderly-care app that connects seniors with their family
            and their doctors. We take your privacy seriously. This policy
            explains what data we collect, how we use it, and how we protect it.
          </Section>

          <Section h="Data we collect">
            • Account information: name, email address or phone number, and role
            (senior / family member / doctor).{'\n'}
            • Health data: vital signs, alerts, medications, and visit notes
            entered by you or your care team.{'\n'}
            • Content: your conversations with the Rafiq AI assistant, and any
            photos you upload.{'\n'}
            • Location data: only if you turn it on, and only to share with the
            care-circle members you authorize. Doctors cannot see location at
            all.
          </Section>

          <Section h="What we do not collect">
            Salem has no in-app voice calls and no family messaging. When Rafiq
            helps a senior reach someone, it opens the phone's own dialer or SMS
            app — the call or message happens outside Salem, and we never
            receive, store, or process its contents.
          </Section>

          <Section h="How we use your data">
            We use your data to run the care service: showing vitals, sending
            alerts to family, and producing Rafiq's summaries. We do not sell
            your data to anyone.
          </Section>

          <Section h="Data sharing">
            Your data is shared only with members of your care circle, according
            to the permissions granted to each member. We rely on trusted service
            providers (hosting, push notifications, AI services) solely to
            operate the app.
          </Section>

          <Section h="Your rights">
            At any time you can download a copy of your data or delete your
            account entirely from the Settings screen. Deletion runs after a
            30-day grace period, which you can cancel. These rights are aligned
            with the Personal Data Protection Law (PDPL) and the GDPR.
          </Section>

          <Section h="Security">
            Your data is protected by row-level security in the database; only
            the people you authorize can reach it. Traffic is encrypted in
            transit.
          </Section>

          <Section h="Contact">
            For any privacy question, contact us at: {CONTACT}
          </Section>

          <View style={styles.divider} />

          <Text style={styles.altTitle}>سياسة الخصوصية (العربية)</Text>

          <Section h="مقدمة" rtl>
            تطبيق «سَليم» مخصص لرعاية كبار السن ويربط بينهم وبين عائلاتهم
            وأطبائهم. نحن نأخذ خصوصيتك على محمل الجد، وهذه السياسة تشرح البيانات
            التي نجمعها وكيف نستخدمها ونحميها.
          </Section>
          <Section h="البيانات التي نجمعها" rtl>
            • معلومات الحساب: الاسم، البريد الإلكتروني أو رقم الهاتف، والدور
            (كبير السن / فرد عائلة / طبيب).{'\n'}
            • البيانات الصحية: المؤشرات الحيوية، التنبيهات، الأدوية، وملاحظات
            الزيارات التي تُدخلها أنت أو فريق الرعاية.{'\n'}
            • المحتوى: المحادثات مع المساعد الذكي «رفيق»، والصور التي ترفعها.
            {'\n'}
            • بيانات الموقع: فقط إذا فعّلتها، ولمشاركتها مع دائرة الرعاية
            المصرّح لها. الأطباء لا يمكنهم رؤية الموقع إطلاقاً.
          </Section>
          <Section h="ما لا نجمعه" rtl>
            لا يحتوي «سَليم» على مكالمات داخل التطبيق ولا رسائل بين أفراد
            العائلة. عندما يساعد «رفيق» كبير السن على الاتصال بشخص ما، فإنه يفتح
            تطبيق الاتصال أو الرسائل في الهاتف نفسه — فتتم المكالمة أو الرسالة
            خارج «سَليم»، ولا نستقبل محتواها أو نخزّنه إطلاقاً.
          </Section>
          <Section h="كيف نستخدم بياناتك" rtl>
            نستخدم بياناتك لتشغيل خدمات الرعاية: عرض المؤشرات، إرسال التنبيهات
            للعائلة، وتقديم ملخصات المساعد الذكي. لا نبيع بياناتك لأي جهة.
          </Section>
          <Section h="مشاركة البيانات" rtl>
            تُشارك بياناتك فقط مع أعضاء دائرة الرعاية حسب الصلاحيات التي تُمنح
            لكل عضو. نستعين بمزوّدي خدمة موثوقين (الاستضافة، الإشعارات، وخدمات
            الذكاء الاصطناعي) لتشغيل التطبيق فقط.
          </Section>
          <Section h="حقوقك" rtl>
            يمكنك في أي وقت تنزيل نسخة من بياناتك أو حذف حسابك بالكامل من شاشة
            الإعدادات. يتم تنفيذ الحذف خلال مدة سماح ٣٠ يوماً يمكنك التراجع
            عنها. هذه الحقوق متوافقة مع نظام حماية البيانات الشخصية (PDPL)
            واللائحة الأوروبية (GDPR).
          </Section>
          <Section h="الأمان" rtl>
            بياناتك محمية بصلاحيات على مستوى الصفوف في قاعدة البيانات، ولا يصل
            إليها إلا من تسمح له أنت. الاتصالات مشفّرة أثناء النقل.
          </Section>
          <Section h="التواصل" rtl>
            لأي سؤال حول الخصوصية، تواصل معنا على: {CONTACT}
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
  // The Arabic half keeps its own direction while the app ships LTR.
  rtl: { textAlign: 'right', writingDirection: 'rtl', fontFamily: fonts.arabicBody },
  divider: { height: 1, backgroundColor: colors.divider },
  altTitle: { ...type.subtitle, color: colors.textSecondary, textAlign: 'right' },
});
