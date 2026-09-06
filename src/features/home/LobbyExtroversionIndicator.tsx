import { ExtroversionGauge } from '../profile/ExtroversionGauge';
import { ExtroversionBand, getExtroversionBand } from '../profile/extroversion';
import { useI18n } from '../../i18n/LocalizationProvider';
import { TranslationKey } from '../../i18n/translations';
import { DemoLobby } from './lobbies';

const bandKeys: Record<ExtroversionBand, TranslationKey> = {
  introvert: 'profile.introvert',
  ambivert: 'profile.ambivert',
  extrovert: 'profile.extrovert',
};

type Props = {
  lobby: Pick<DemoLobby, 'id' | 'groupExtroversionLevel'>;
  size?: number;
};

export function LobbyExtroversionIndicator({ lobby, size = 32 }: Props) {
  const { t } = useI18n();
  const band = getExtroversionBand(lobby.groupExtroversionLevel);

  return (
    <ExtroversionGauge
      testID={`lobby-extroversion-${lobby.id}`}
      level={lobby.groupExtroversionLevel}
      size={size}
      accessibilityLabel={`${t('home.groupExtroversion')}: ${t(bandKeys[band])}`}
    />
  );
}
