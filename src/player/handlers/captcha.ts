import { EoReader, PacketAction } from 'eolib';
import { CaptchaReplyClientPacket, CaptchaRequestClientPacket } from '../../deep/index.ts';
import { log } from '../../log.ts';
import type { Player } from '../player.ts';

export function handleCaptcha(player: Player, action: number, reader: EoReader): void {
  if (!player.isDeep) return;
  switch (action) {
    case PacketAction.Reply: {
      const reply = CaptchaReplyClientPacket.deserialize(reader);
      player.answerCaptcha(reply.captcha);
      break;
    }
    case PacketAction.Request:
      CaptchaRequestClientPacket.deserialize(reader);
      player.refreshCaptcha();
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Captcha action');
  }
}
