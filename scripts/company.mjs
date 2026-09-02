/**
 * Clindar's registered company identity — the single source of truth.
 *
 * The site is hand-authored HTML plus one generator, with no shared partial
 * system, so these strings necessarily appear in several files. Rather than
 * migrate the whole site to a template engine for a legal-identity line, the
 * generator imports them from here and tests/company-details.test.js asserts
 * that every hand-authored page carries the identical wording. Change a value
 * here and that test tells you exactly which page still disagrees.
 *
 * Only the stable identity belongs in this file: what the company is called,
 * its registration code, where it is registered, and how to write to it.
 * Incorporation date, share capital, headcount, financials and officer names
 * are all either volatile or nobody's business on a marketing site. There is
 * deliberately no VAT number: one has not been verified, and an unverified or
 * lapsed VAT identifier on a public page is worse than none.
 */

export const COMPANY = {
  legalName: 'Clindar, UAB',
  registrationCode: '308107046',
  streetAddress: 'Laisvės pr. 78-11',
  postalCode: 'LT-05263',
  locality: 'Vilnius',
  country: 'Lithuania',
  /** ISO 3166-1 alpha-2, for structured data. */
  countryCode: 'LT',
  email: 'info@clindar.eu',
};

/** The compact one-line form used in every page footer. */
export const REGISTERED_LINE =
  `${COMPANY.legalName} · Company code ${COMPANY.registrationCode} · ` +
  `${COMPANY.streetAddress}, ${COMPANY.postalCode} ${COMPANY.locality}, ${COMPANY.country}`;

/** The sentence form used where a controller has to be named in full. */
export const CONTROLLER_LINE =
  `${COMPANY.legalName}, company code ${COMPANY.registrationCode}, registered at ` +
  `${COMPANY.streetAddress}, ${COMPANY.postalCode} ${COMPANY.locality}, ${COMPANY.country}.`;
