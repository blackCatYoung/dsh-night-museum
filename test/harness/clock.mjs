/**
 * Pin the wall clock just past 18:00 while still letting it advance.
 *
 * The 18:00 reminder is part of the client behaviour under test, but the
 * reminder only shows after 18:00 local time. Without this module the client
 * test passes in the evening and fails during the day. Importing this module
 * installs the clock before any other harness module is evaluated.
 */

const RealDate = Date

const base = new RealDate()
base.setHours(19, 0, 0, 0)
const offset = base.getTime() - RealDate.now()

class EveningDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offset)
    else super(...args)
  }

  static now() {
    return RealDate.now() + offset
  }
}

globalThis.Date = EveningDate

export { RealDate }
