import DriveBindModal from '../../components/DriveBindModal';
import { driveBindingAdapter } from './adapters/driveBindingAdapter';
import type { DriveBindModalProps } from '../../components/DriveBindModal';

export type DriveBindingDialogProps = Omit<DriveBindModalProps, 'ports'>;

export function DriveBindingDialog(props: DriveBindingDialogProps) {
  return <DriveBindModal {...props} ports={driveBindingAdapter} />;
}
