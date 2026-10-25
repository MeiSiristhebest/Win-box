import { client } from '../../../api/client';
import type { DriveBindingPorts } from '../application/driveBindingPorts';

export const driveBindingAdapter: DriveBindingPorts = {
  credentials: {
    load: () => client.driveGet(),
    save: (provider, cookie) => client.driveSet(provider, cookie),
    remove: provider => client.driveRemove(provider),
  },
  webLogin: {
    login: provider => client.driveWebLogin(provider),
  },
  ucTvToken: {
    status: async () => {
      const result = await client.ucTvStatus();
      return { bound: !!result.bound };
    },
    createQr: () => client.ucTvQrCreate(),
    pollQr: () => client.ucTvQrPoll(),
    remove: () => client.ucTvRemove(),
  },
};
