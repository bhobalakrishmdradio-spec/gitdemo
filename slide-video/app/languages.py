"""Narration languages: neural voices, offline espeak-ng voice, and caption font script."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    name: str
    voices: dict[str, str]  # edge-tts voice id -> label
    espeak: str             # espeak-ng voice for the offline fallback
    script: str = ""        # Noto font script for captions ("" = Latin, uses DejaVu)


LANGUAGES: dict[str, Language] = {
    "en": Language("English", {
        "en-US-AriaNeural": "Aria (US, female)",
        "en-US-GuyNeural": "Guy (US, male)",
        "en-US-JennyNeural": "Jenny (US, female)",
        "en-GB-SoniaNeural": "Sonia (UK, female)",
        "en-GB-RyanNeural": "Ryan (UK, male)",
        "en-IN-NeerjaNeural": "Neerja (India, female)",
        "en-IN-PrabhatNeural": "Prabhat (India, male)",
        "en-AU-NatashaNeural": "Natasha (Australia, female)",
    }, "en-us"),
    "hi": Language("Hindi", {"hi-IN-SwaraNeural": "Swara (female)", "hi-IN-MadhurNeural": "Madhur (male)"}, "hi", "Devanagari"),
    "mr": Language("Marathi", {"mr-IN-AarohiNeural": "Aarohi (female)", "mr-IN-ManoharNeural": "Manohar (male)"}, "mr", "Devanagari"),
    "ta": Language("Tamil", {"ta-IN-PallaviNeural": "Pallavi (female)", "ta-IN-ValluvarNeural": "Valluvar (male)"}, "ta", "Tamil"),
    "te": Language("Telugu", {"te-IN-ShrutiNeural": "Shruti (female)", "te-IN-MohanNeural": "Mohan (male)"}, "te", "Telugu"),
    "ml": Language("Malayalam", {"ml-IN-SobhanaNeural": "Sobhana (female)", "ml-IN-MidhunNeural": "Midhun (male)"}, "ml", "Malayalam"),
    "kn": Language("Kannada", {"kn-IN-SapnaNeural": "Sapna (female)", "kn-IN-GaganNeural": "Gagan (male)"}, "kn", "Kannada"),
    "bn": Language("Bengali", {"bn-IN-TanishaaNeural": "Tanishaa (female)", "bn-IN-BashkarNeural": "Bashkar (male)"}, "bn", "Bengali"),
    "es": Language("Spanish", {
        "es-ES-ElviraNeural": "Elvira (Spain, female)",
        "es-ES-AlvaroNeural": "Álvaro (Spain, male)",
        "es-MX-DaliaNeural": "Dalia (Mexico, female)",
    }, "es"),
    "fr": Language("French", {"fr-FR-DeniseNeural": "Denise (female)", "fr-FR-HenriNeural": "Henri (male)"}, "fr-fr"),
    "de": Language("German", {"de-DE-KatjaNeural": "Katja (female)", "de-DE-ConradNeural": "Conrad (male)"}, "de"),
}
DEFAULT_LANGUAGE = "en"


def get_language(code: str) -> Language:
    return LANGUAGES.get(code, LANGUAGES[DEFAULT_LANGUAGE])


def pick_voice(code: str, voice: str) -> str:
    """The requested voice if it belongs to the language, else the language's first voice."""
    voices = get_language(code).voices
    return voice if voice in voices else next(iter(voices))
