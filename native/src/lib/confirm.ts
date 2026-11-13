// Yes / no dialog (native Alert). Kept as a helper so every destructive flow
// (sign out, delete, …) reads the same way it does in the Expo app.
import { Alert } from 'react-native';

export function confirm(opts: {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  const { title, message, confirmLabel, cancelLabel, destructive, onConfirm, onCancel } = opts;

  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel', onPress: onCancel },
    {
      text: confirmLabel,
      style: destructive ? 'destructive' : 'default',
      onPress: onConfirm,
    },
  ]);
}
