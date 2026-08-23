import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Le code PIN de clôture de caisse.
 *
 * ## Pourquoi scrypt, et non « le mécanisme déjà en place »
 *
 * Il n'y en avait pas : l'application ne hache aucun mot de passe. Les
 * comptes vivent dans Supabase Auth, qui s'en charge de son côté, et rien
 * dans ce dépôt ne manipulait de secret. `scrypt` vient du module `crypto`
 * de Node — aucune dépendance nouvelle, et c'est la primitive prévue pour
 * cet usage.
 *
 * ## Le paramètre qui compte ici
 *
 * Un PIN de 4 à 6 chiffres, c'est au plus un million de possibilités : un
 * attaquant qui obtiendrait le haché les épuiserait toutes. Le coût de
 * calcul est donc la seule défense, et il est réglé haut (N = 2^15) parce
 * qu'une vérification par clôture — quelques par jour — peut se permettre
 * une centaine de millisecondes. Ce que le hachage protège vraiment, c'est
 * la lecture accidentelle en base ou dans une sauvegarde ; contre le vol
 * du haché, un PIN reste un PIN.
 */

const COUT_N = 2 ** 15;
const LONGUEUR_CLE = 64;
const OCTETS_SEL = 16;

/**
 * Plafond mémoire, à passer explicitement.
 *
 * scrypt consomme environ 128 × N × r octets, soit ~33 Mo à N = 2^15 avec
 * le r par défaut de 8. Le plafond par défaut de Node est de 32 Mo : sans
 * ce réglage, `scryptSync` lève « memory limit exceeded » — et il le
 * lèverait au premier PIN enregistré, pas au développement.
 */
const MEMOIRE_MAX = 64 * 1024 * 1024;

/** Format stocké : `scrypt$<sel hex>$<clé hex>`, autodescriptif pour la relecture. */
const PREFIXE = "scrypt";

export const PIN_MIN = 4;
export const PIN_MAX = 6;

/** Un PIN valide : 4 à 6 chiffres, rien d'autre. */
export function pinValide(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

export function hacherPin(pin: string): string {
  if (!pinValide(pin)) {
    throw new Error(`Le code PIN doit comporter ${PIN_MIN} à ${PIN_MAX} chiffres.`);
  }
  const sel = randomBytes(OCTETS_SEL);
  const cle = scryptSync(pin, sel, LONGUEUR_CLE, { N: COUT_N, maxmem: MEMOIRE_MAX });
  return `${PREFIXE}$${sel.toString("hex")}$${cle.toString("hex")}`;
}

/**
 * `false` plutôt qu'une exception sur un haché illisible : un PIN qu'on
 * n'arrive pas à relire doit refuser la clôture, pas faire tomber l'écran.
 *
 * La comparaison passe par `timingSafeEqual`. Sur un secret de six
 * chiffres l'apport est théorique, mais comparer des hachés avec `===`
 * est l'erreur qu'on ne remarque que le jour où le secret s'allonge.
 */
export function verifierPin(pin: string, hache: string | null): boolean {
  if (!hache) return false;

  const [prefixe, selHex, cleHex] = hache.split("$");
  if (prefixe !== PREFIXE || !selHex || !cleHex) return false;

  let attendue: Buffer;
  try {
    attendue = Buffer.from(cleHex, "hex");
    if (attendue.length !== LONGUEUR_CLE) return false;
  } catch {
    return false;
  }

  const calculee = scryptSync(pin, Buffer.from(selHex, "hex"), LONGUEUR_CLE, {
    N: COUT_N,
    maxmem: MEMOIRE_MAX,
  });
  return timingSafeEqual(calculee, attendue);
}
