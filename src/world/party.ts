export interface Party {
  leaderId: number;
  memberIds: number[];
}

export class PartyManager {
  private readonly parties: Party[] = [];

  partyOf(playerId: number): Party | undefined {
    return this.parties.find((p) => p.memberIds.includes(playerId));
  }

  create(leaderId: number, memberId: number): Party | null {
    if (leaderId === memberId) return null;
    if (this.partyOf(leaderId) !== undefined || this.partyOf(memberId) !== undefined) return null;
    const party: Party = { leaderId, memberIds: [leaderId, memberId] };
    this.parties.push(party);
    return party;
  }

  addMember(party: Party, playerId: number): boolean {
    if (!this.parties.includes(party)) return false;
    if (this.partyOf(playerId) !== undefined) return false;
    party.memberIds.push(playerId);
    return true;
  }

  removeMember(playerId: number): { party: Party; disbanded: boolean } | null {
    const party = this.partyOf(playerId);
    if (party === undefined) return null;
    const wasLeader = party.leaderId === playerId;
    party.memberIds = party.memberIds.filter((id) => id !== playerId);
    if (wasLeader || party.memberIds.length < 2) {
      this.parties.splice(this.parties.indexOf(party), 1);
      return { party, disbanded: true };
    }
    return { party, disbanded: false };
  }
}
