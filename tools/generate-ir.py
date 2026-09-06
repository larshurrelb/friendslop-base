"""Deterministic original synthetic stereo IRs; no third-party samples."""
import math, random, struct, wave
from pathlib import Path
root=Path(__file__).resolve().parents[1]
# The yard is outdoors: a short, sparse slap off the walls and nothing more.
for name,seconds,seed in [('room',.35,41),('hall',1.6,73),('yard',.28,109)]:
    rng=random.Random(seed);frames=[];last=[0.,0.];count=int(48000*seconds)
    for i in range(count):
        t=i/48000;pair=[]
        for channel in range(2):
            last[channel]=last[channel]*.7+rng.uniform(-1,1)*.3
            envelope=math.exp(-6.9*t/seconds)*min(1,t/.012)
            value=last[channel]*envelope*.45
            for delay,gain in [(.017,.5),(.029,.32),(.047,.2)]:
                if i==int((delay+channel*.0017)*48000):value+=gain
            pair.append(int(max(-1,min(1,value))*32767))
        frames.append(struct.pack('<hh',*pair))
    path=root/'public/audio'/f'{name}.wav';path.parent.mkdir(parents=True,exist_ok=True)
    with wave.open(str(path),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(48000);f.writeframes(b''.join(frames))
# A plain tone exercises the real microphone path in Chrome without including a
# recording of a person or any third-party sound.
path=root/'tests/voice-fixture.wav'
frames=[struct.pack('<h',int(math.sin(i/48000*440*2*math.pi)*5000)) for i in range(48000*3)]
with wave.open(str(path),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(48000);f.writeframes(b''.join(frames))
print('Generated original room, hall and yard impulse responses and test tone.')
