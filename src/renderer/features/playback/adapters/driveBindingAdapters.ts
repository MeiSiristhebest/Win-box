import { client } from '../../../api/client';
import { driveProviderFromUrl } from '../../../../shared/driveProvider';
import type { DriveBindingNavigationPort, DriveBindingPromptPort } from '../application/driveBindingPorts';

export const driveBindingPromptAdapter: DriveBindingPromptPort = {
  getCredentials: () => client.driveGet(),
  providerFromUrl: driveProviderFromUrl,
};

export const driveBindingNavigationAdapter: DriveBindingNavigationPort = {
  openBindingSettings: () => client.gotoDriveBind(),
};
