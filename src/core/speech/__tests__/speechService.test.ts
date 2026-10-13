import { createExpoSpeechService } from '../speechService';

const makeSpeech = () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  isSpeakingAsync: jest.fn(async () => false),
});

describe('speechService', () => {
  it('speaks with language + rate and forwards onDone', async () => {
    const Speech = makeSpeech();
    const onDone = jest.fn();
    const service = createExpoSpeechService(Speech as never);
    service.speak('Phrase', { language: 'fr', rate: 1.5, onDone });
    expect(Speech.speak).toHaveBeenCalledWith('Phrase', expect.objectContaining({ language: 'fr-FR', rate: 1.5 }));
    (Speech.speak.mock.calls[0] as unknown as [string, { onDone: () => void }])[1].onDone();
    expect(onDone).toHaveBeenCalled();
  });

  it('maps control verbs and speaking()', async () => {
    const Speech = makeSpeech();
    const service = createExpoSpeechService(Speech as never);
    service.stop(); service.pause(); service.resume();
    expect(Speech.stop).toHaveBeenCalled();
    expect(Speech.pause).toHaveBeenCalled();
    expect(Speech.resume).toHaveBeenCalled();
    expect(await service.speaking()).toBe(false);
    expect(Speech.isSpeakingAsync).toHaveBeenCalled();
  });
});
