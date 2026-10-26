import { useState } from 'react';
import { DriveBindingDialog } from '../driveBinding/DriveBindingDialog';
import type { DriveAccountsEventsPort } from './application/driveAccountsEventsPort';
import { DriveAccountsView } from './DriveAccountsView';

export function DriveAccountsSection({ events }: { events: DriveAccountsEventsPort }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DriveAccountsView onManage={() => setOpen(true)} />
      {open && (
        <DriveBindingDialog
          siteName="所有子仓与站点"
          onClose={() => setOpen(false)}
          onSaved={events.notifyChanged}
        />
      )}
    </>
  );
}
