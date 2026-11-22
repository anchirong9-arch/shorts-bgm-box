# 🎵 쇼츠 브금 박스 (shorts-bgm-box)

유튜브 쇼츠·틱톡·인스타 릴스에 **저작권 걱정 없이 바로 쓰는 CC0(퍼블릭 도메인) 무료 BGM 20곡** 모음입니다.
검색 · 카테고리 필터 · 바로 듣기 · MP3 원클릭 다운로드 · 전체 ZIP 다운로드를 웹에서 바로 쓸 수 있습니다.

- 사이트: <https://anchirong9-arch.github.io/shorts-bgm-box/>
- 곡 수: 20곡 / 총 40분 / 약 76MB (원본 MP3 그대로)

## 카테고리

| 카테고리 | 곡 수 | 쓰는 곳 |
|---|---|---|
| 😂 웃김·병맛·코믹 | 4 | 상황극, 리액션, 장난 짤 |
| 🏃 긴박·추격·킹받음 | 4 | 사건 전개, 추격, 빠른 편집 |
| ☕ 일상·힐링·동물 | 4 | 브이로그, 반려동물, 감성 |
| ⚡ 반전·드라마틱·호러 | 4 | 반전, 캐릭터 등장, 공포 |
| 🛒 신나는·쇼핑·리뷰 | 4 | 언박싱, 리뷰, 정보 전달 |

## 라이선스 — CC0 1.0 (Public Domain)

- 전곡 **CC0 1.0**. 상업적 이용, 유튜브 수익 창출, 편집·리믹스 가능. **출처 표기 의무 없음.**
- 원본 출처: **FreePD.com** (2008–2025 운영, 2025년 서비스 종료). FreePD는 전곡을 *Creative Commons 0 / No Attribution*으로 배포했고, 각 곡 페이지에 "This music is available for commercial and non-commercial purposes."라고 명시했습니다.
- 서비스 종료 후 원본은 인터넷 아카이브에 보존되어 있습니다: <https://archive.org/details/freepd> (수록곡은 `comedy/`, `epic/`, `scoring/`, `upbeat/`, `misc/` 등 원래 카테고리 폴더 그대로 보존). 아카이브 미러의 라이선스 표기는 CC0 1.0이며, 곡별 원본 경로는 [`assets/data/tracks.json`](assets/data/tracks.json)과 사이트 하단 ‘곡별 출처’ 표에 그대로 적어 두었습니다.
- 이 저장소는 원본 MP3를 **재인코딩 없이 그대로** 담았습니다(음질 손실 없음).

곡별 작곡가·원본 경로·라이선스 표는 [NOTICE.md](NOTICE.md) 참고.

## 저장소 구조

```
index.html                    # 사이트 (GitHub Pages 루트)
assets/css/style.css
assets/js/app.js              # 검색·필터·플레이어·다운로드 로직 (의존성 없음)
assets/data/tracks.json       # 곡 메타데이터 (제목, 작곡가, BPM, 길이, 태그, 원본 경로)
assets/bgm/*.mp3              # 원본 MP3 20곡
zips/shorts-bgm-box-all.zip   # 전체 20곡 ZIP
zips/{카테고리}.zip            # 카테고리별 ZIP (5개)
```

## 기능

- 카테고리 칩 필터 + 곡 이름·분위기·작곡가·추천 용도 검색
- 정렬: 추천 순 / 짧은 곡 / 긴 곡 / BPM 낮은·높은 순
- 하단 고정 플레이어: 재생·일시정지, 구간 탐색(seek), 이전·다음 곡, 한 곡 반복
- 곡별 `⬇ MP3` 원클릭 다운로드, 카테고리별 ZIP, 전체 ZIP
- 곡마다 `CC0` 배지와 `상업적 이용/수익 창출 OK` 표기, 하단에 전곡 출처 표

## BPM 표기 안내

BPM은 각 MP3를 디코딩해 온셋(타격) 기반으로 자동 분석한 값입니다. 반올림 표시(≈)이며 실제 템포의 절반/두 배로 계산될 수 있습니다(옥타브 오류). 편집 템포를 맞출 때 참고용으로만 쓰세요.

## 곡 추가하기

1. CC0 음원을 `assets/bgm/`에 넣습니다.
2. `assets/data/tracks.json`의 `tracks` 배열에 항목을 추가합니다(제목, 작곡가, 카테고리, BPM, 길이, 태그, 원본 경로).
3. `zips/`를 다시 만들고 커밋·푸시하면 사이트에 바로 반영됩니다.
