import type { ProfileActivationPort } from './configurationPagePorts';

export type ActivateConfigurationProfilePorts = {
  profile: ProfileActivationPort;
  refreshConfiguration(): Promise<void>;
};

/** Activates a saved profile, broadcasts the transition, then refreshes its snapshot. */
export async function activateConfigurationProfile(
  profileId: string,
  ports: ActivateConfigurationProfilePorts,
): Promise<void> {
  await ports.profile.activate(profileId);
  ports.profile.announceProfileChanged();
  await ports.refreshConfiguration();
}
