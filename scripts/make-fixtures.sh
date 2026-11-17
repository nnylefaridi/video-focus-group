#!/bin/bash
# Regenerates the committed test videos in tests/fixtures (macOS: needs ffmpeg and `say`).
# Only used to make test fixtures; the app itself never runs ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/../tests/fixtures"
T=$(mktemp -d)
say -v Samantha -o "$T/speech.aiff" "My cat is judging my cooking tonight"
# Audio: 0-1 s silence, 1-3.5 s speech, 3.5-5 s silence, 5-8 s sine tone.
ffmpeg -v error -y -i "$T/speech.aiff" -f lavfi -i "sine=frequency=440:duration=3:sample_rate=48000" -filter_complex \
 "[0:a]aresample=48000,aformat=channel_layouts=mono,atrim=0:2.5,apad=whole_dur=2.5,adelay=1000[s];[s]apad=whole_dur=5[sp];[1:a]volume=0.3[t];[sp][t]concat=n=2:v=0:a=1[a]" \
 -map "[a]" -t 8 "$T/audio.wav"
# Video: 1080x1920, 30 fps, hard cuts at 3.0 s and 5.5 s.
ffmpeg -v error -y \
 -f lavfi -i "testsrc2=size=1080x1920:rate=30:duration=3" \
 -f lavfi -i "color=c=0x2a7a4a:size=1080x1920:rate=30:duration=2.5" \
 -f lavfi -i "mandelbrot=size=1080x1920:rate=30" \
 -i "$T/audio.wav" -filter_complex "[2:v]trim=duration=2.5,setpts=PTS-STARTPTS[m];[0:v][1:v][m]concat=n=3:v=1:a=0,format=yuv420p[v]" \
 -map "[v]" -map 3:a -c:v libx264 -preset veryfast -crf 30 -c:a aac -b:a 96k -t 8 -movflags +faststart vertical-8s.mov
ffmpeg -v error -y -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=4" -f lavfi -i "sine=frequency=440:duration=4" \
 -c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p -c:a aac -b:a 64k -shortest -movflags +faststart horizontal-4s.mp4
ffmpeg -v error -y -f lavfi -i "color=c=0x445566:size=180x320:rate=10:duration=190" -f lavfi -i "anullsrc=r=22050:cl=mono" \
 -c:v libx264 -preset veryfast -crf 40 -pix_fmt yuv420p -c:a aac -b:a 16k -t 190 -movflags +faststart long-190s.mp4
rm -rf "$T"
ls -l
# Parser fixtures for src/media/mp4.ts tests: moov after mdat, and HEVC.
cd "$(dirname "$0")/../tests/fixtures" 2>/dev/null || true
ffmpeg -v error -y -f lavfi -i "testsrc2=size=360x640:rate=15:duration=2" -c:v libx264 -preset veryfast -crf 40 -pix_fmt yuv420p not-faststart.mp4
ffmpeg -v error -y -f lavfi -i "testsrc2=size=360x640:rate=15:duration=2" -c:v libx265 -preset veryfast -crf 40 -pix_fmt yuv420p -tag:v hvc1 hevc.mp4 2>/dev/null || echo "no libx265; hevc.mp4 skipped"
# What a browser sends: 720x1280 H.264 + AAC, faststart, no metadata tags (tests of the server's checks).
ffmpeg -v error -y -i vertical-8s.mov -vf scale=720:1280 -c:v libx264 -preset veryfast -crf 32 -c:a aac -b:a 64k \
 -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact -movflags +faststart prepared-720.mp4
