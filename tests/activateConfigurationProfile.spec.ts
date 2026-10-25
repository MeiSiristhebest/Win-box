import { describe, expect, it, vi } from 'vitest';
import type { ProfileActivationPort } from '../src/renderer/features/settings/application/configurationPagePorts';
import { activateConfigurationProfile } from '../src/renderer/features/settings/application/activateConfigurationProfile';

describe('activateConfigurationProfile', () => {
  it('activates the profile, announces the transition, then refreshes configuration', async () => {
    const calls: string[] = [];
    const profile: ProfileActivationPort = {
      activate: vi.fn(async (profileId: string) => { calls.push('activate:' + profileId); }),
      announceProfileChanged: vi.fn(() => { calls.push('announce'); }),
    };
    const refreshConfiguration = vi.fn(async () => { calls.push('refresh'); });

    await activateConfigurationProfile('profile-42', { profile, refreshConfiguration });

    expect(calls).toEqual(['activate:profile-42', 'announce', 'refresh']);
    expect(profile.activate).toHaveBeenCalledWith('profile-42');
    expect(refreshConfiguration).toHaveBeenCalledOnce();
  });

  it('does not announce or refresh when activation fails', async () => {
    const failure = new Error('activation failed');
    const profile: ProfileActivationPort = {
      activate: vi.fn().mockRejectedValue(failure),
      announceProfileChanged: vi.fn(),
    };
    const refreshConfiguration = vi.fn();

    await expect(activateConfigurationProfile('profile-42', { profile, refreshConfiguration })).rejects.toBe(failure);

    expect(profile.announceProfileChanged).not.toHaveBeenCalled();
    expect(refreshConfiguration).not.toHaveBeenCalled();
  });
});
