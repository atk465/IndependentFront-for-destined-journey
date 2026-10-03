import {
  getDatabase,
  saveCharacter,
  saveSaveSlot,
  savePlotOutline,
  savePlotEvents,
} from './database';
import { getProfile, addFP, updateProfile } from './save-profile';
import type { CharacterState, SaveSlot, PlotOutline, PlotEvent } from './types';

/** Publish a complete new journey, or leave no records behind on failure. */
export async function createJourney(input: {
  character: CharacterState;
  /** 伙伴实体（伙伴实体化 D3 获得即诞生，批①）：开局保底/购卡的召唤卡随档同事务诞生；缺省无 */
  companions?: CharacterState[];
  save: SaveSlot;
  era: string;
  experienceMode: 'normal' | 'easy';
  startingPoints: number;
  outline?: PlotOutline;
  events: PlotEvent[];
}): Promise<string> {
  const db = getDatabase();
  await db.transaction(
    'rw',
    [db.characters, db.saves, db.saveProfiles, db.plotOutlines, db.plotEvents],
    async () => {
      await saveCharacter(input.character);
      for (const companion of input.companions ?? []) {
        await saveCharacter(companion);
      }
      await saveSaveSlot(input.save);
      const profile = await getProfile(input.save.id, input.era);
      profile.experienceMode = input.experienceMode;
      if (input.startingPoints > 0) {
        await addFP(profile, input.startingPoints, '开局兑换的命运点', 'other');
      } else {
        await updateProfile(profile);
      }
      if (input.outline) await savePlotOutline(input.outline);
      if (input.events.length) await savePlotEvents(input.events);
    },
  );
  return input.save.id;
}
