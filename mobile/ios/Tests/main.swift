import Foundation

var now = Date(timeIntervalSince1970: 1000)
let timer = SleepTimer(now: { now })
assert(!timer.consumeExpired())
timer.set(minutes: 15)
now += 899
assert(timer.minutesRemaining == 1 && !timer.consumeExpired())
now += 1
assert(timer.consumeExpired(), "Deadline wins at the exact end boundary")
assert(!timer.consumeExpired(), "A delayed tick or duplicate completion must not stop twice")
timer.set(minutes: 30)
now += 3600
assert(timer.consumeExpired(), "Foreground resume must catch an expired suspended timer")
timer.set(minutes: 15)
timer.set(minutes: 0)
now += 3600
assert(timer.minutesRemaining == nil && !timer.consumeExpired())
timer.set(minutes: 15)
now += 600
timer.set(minutes: 30)
now += 900
assert(!timer.consumeExpired() && timer.minutesRemaining == 15, "Replacing a timer starts a new deadline")
print("iOS sleep timer: 5 scenarios passed")
