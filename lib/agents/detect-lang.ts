/**
 * detectLangFromText — lightweight language detector based on word frequency scoring.
 *
 * Scores the input against high-frequency, language-unique words (stopwords + common verbs).
 * Returns an ISO 639-1 code ('it', 'es', 'en', 'fr', 'de', 'pt').
 * Falls back to 'it' when ambiguous or empty.
 *
 * Designed to work well on short chat messages (5-50 words) and to correctly
 * handle language switches mid-conversation (evaluated per-message, not cumulatively).
 */

const LANG_WORDS: Record<string, string[]> = {
  en: [
    'the','and','is','are','to','of','in','it','you','that','this','for',
    'with','on','as','was','be','at','by','an','or','but','not','can',
    'have','do','will','your','from','we','want','need','please','make',
    'create','add','update','change','remove','get','set','use','show',
    'also','just','like','some','all','if','so','there','my','our',
    'i\'m','i\'ve','i\'d','could','would','should','let','me','now',
  ],
  it: [
    'il','la','le','gli','i','lo','un','una','è','sono','sei','siamo',
    'ho','hai','ha','abbiamo','e','o','ma','non','con','di','da','in',
    'su','per','tra','fra','che','qui','come','quando','dove','perché',
    'voglio','vuoi','vuole','posso','puoi','può','fai','fai','metti',
    'crea','aggiungi','cambia','modifica','rimuovi','mostra','prova',
    'anche','solo','tutto','qualcosa','ancora','già','sempre','mai',
  ],
  es: [
    'el','los','las','un','una','es','son','ser','está','están','hay',
    'yo','tú','él','ella','nosotros','ellos','que','con','por','para',
    'en','de','del','al','y','o','pero','no','si','como','cuando',
    'quiero','quieres','quiere','puedo','puedes','puede','haz','pon',
    'crea','añade','agrega','cambia','modifica','elimina','muestra',
    'también','solo','todo','algo','muy','bien','gracias','favor',
  ],
  fr: [
    'le','la','les','l\'','un','une','des','est','sont','être','avoir',
    'je','tu','il','elle','nous','vous','ils','que','qui','quoi','où',
    'avec','pour','dans','sur','par','et','ou','mais','pas','non',
    'veux','veut','peux','peut','pouvez','fais','mets','crée','ajoute',
    'change','modifie','supprime','montre','aussi','très','bien','merci',
  ],
  de: [
    'der','die','das','ein','eine','ist','sind','bin','war','haben','sein',
    'ich','du','er','sie','es','wir','ihr','nicht','kein','und','oder',
    'aber','mit','von','aus','auf','in','für','an','bei','nach',
    'will','kann','mache','mach','erstelle','füge','ändere','entferne',
    'zeige','auch','sehr','schon','noch','bitte','danke','ja','nein',
  ],
  pt: [
    'o','a','os','as','um','uma','é','são','ser','ter','estar',
    'eu','tu','ele','ela','nós','vocês','eles','que','com','por',
    'para','de','em','na','no','do','da','e','ou','mas','não',
    'quero','quer','posso','pode','faça','coloque','crie','adicione',
    'mude','modifique','remova','mostre','também','muito','bem','obrigado',
  ],
}

export function detectLangFromText(text: string): string {
  if (!text || text.trim().length < 3) return 'it'

  const words = text.toLowerCase().match(/[a-zàáâãäåæçèéêëìíîïòóôõöùúûüýÿñ']+/g) ?? []
  if (words.length === 0) return 'it'

  const scores: Record<string, number> = {}
  for (const [lang, wordList] of Object.entries(LANG_WORDS)) {
    const set = new Set(wordList)
    scores[lang] = words.filter(w => set.has(w)).length
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])
  // If top score is 0, return default
  if (best[0][1] === 0) return 'it'
  // If top two are tied and one is 'it', prefer the other (avoid false Italian matches)
  if (best[0][1] === best[1][1] && best[0][0] === 'it') return best[1][0]
  return best[0][0]
}

/** Human-readable language name for use in system prompts. */
export function langName(code: string): string {
  const names: Record<string, string> = {
    it: 'Italian', en: 'English', es: 'Spanish',
    fr: 'French', de: 'German', pt: 'Portuguese',
  }
  return names[code] ?? 'Italian'
}
