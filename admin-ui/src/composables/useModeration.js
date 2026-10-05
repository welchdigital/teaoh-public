import { api } from '../api.js';
import { adminLabel, formatMinutes } from '../util.js';
import { useAction } from './useAction.js';

function staffNote(c) {
  return c.adminLevel > 0 ? `\n\nNote: ${c.name} is staff (${adminLabel(c.adminLevel)}).` : '';
}

function extrasText(banIp, banHdid) {
  if (banIp && banHdid) return ', their IP address and hardware ID';
  if (banIp) return ' and their IP address';
  if (banHdid) return ' and their hardware ID';
  return '';
}

function durationText(minutes) {
  return minutes === null ? 'permanently' : `for ${formatMinutes(minutes)}`;
}

export function useModeration(onDone) {
  const { busy, isBusy, errorFor, clearError, run } = useAction();

  async function act(fn, options) {
    const result = await run(fn, options);
    if (result && onDone) await onDone(result, options.key);
    return result;
  }

  return {
    busy,
    isBusy,
    errorFor,
    clearError,
    message: (c, message) =>
      act(() => api.messageCharacter(c.id, message), {
        key: 'message',
        success: `Message sent to ${c.name}`,
      }),
    warp: (c, dest) =>
      act(() => api.warpCharacter(c.id, dest), {
        key: 'warp',
        success: `Warped ${c.name} to map ${dest.map}${dest.x !== null && dest.x !== undefined ? ` (${dest.x}, ${dest.y})` : ''}`,
      }),
    jail: (c) =>
      act(() => api.jailCharacter(c.id), {
        key: 'jail',
        confirm: {
          title: 'Jail character',
          message: `Send ${c.name} to jail?${staffNote(c)}`,
          confirmLabel: 'Jail',
          danger: true,
        },
        success: `${c.name} sent to jail`,
      }),
    free: (c) =>
      act(() => api.freeCharacter(c.id), { key: 'free', success: `${c.name} freed from jail` }),
    freeze: (c) =>
      act(() => api.freezeCharacter(c.id), { key: 'freeze', success: `${c.name} frozen` }),
    unfreeze: (c) =>
      act(() => api.unfreezeCharacter(c.id), { key: 'unfreeze', success: `${c.name} unfrozen` }),
    mute: (c, durationMinutes, reason) =>
      act(() => api.muteCharacter(c.id, { durationMinutes, reason }), {
        key: 'mute',
        success: `${c.name} muted ${durationMinutes === null ? 'indefinitely' : `for ${formatMinutes(durationMinutes)}`}`,
      }),
    unmute: (c) =>
      act(() => api.unmuteCharacter(c.id), { key: 'unmute', success: `${c.name} unmuted` }),
    kick: (c, silent = false) =>
      act(() => api.kickCharacter(c.id, { silent }), {
        key: 'kick',
        confirm: {
          title: silent ? 'Silent kick' : 'Kick character',
          message: `Disconnect ${c.name}${silent ? ' without announcing it in game' : ''}?${staffNote(c)}`,
          confirmLabel: silent ? 'Kick silently' : 'Kick',
          danger: true,
        },
        success: `${c.name} kicked`,
      }),
    ban: (c, { durationMinutes, reason, banIp, banHdid, silent, force }) =>
      act(
        () => api.createBan({ characterName: c.name, durationMinutes, reason, banIp, banHdid, silent, force: banIp && force }),
        {
          key: 'ban',
          confirm: {
            title: 'Ban character',
            message: `Ban ${c.name}'s account ${durationText(durationMinutes)}${extrasText(banIp, banHdid)}?${reason ? `\nReason: ${reason}` : ''}${banIp && force ? '\nForce: loopback and proxy address checks are skipped.' : ''}${c.online ? '\nThey will be disconnected.' : ''}${staffNote(c)}`,
            confirmLabel: 'Ban',
            danger: true,
          },
          success: `${c.name} banned ${durationText(durationMinutes)}`,
        },
      ),
  };
}
