# Stage manager — PinkyBua notes

## Stage console
Open **Stage and Queue**, pick the function. The big **CALL NEXT** button calls the next waiting token; the TV shows it and announces it (or chimes if speech is off or fails). A double tap never calls two families: each press carries one idempotency key.

## Pause and resume
**PAUSE** stops CALL NEXT (it answers "queue paused") and the TV shows a short-break message. **RESUME** continues.

## Skip, on stage, served, no-show
- **Skip** sends a family to the back of the queue. A second skip marks them no-show. Skip needs the queue.skip permission (granted to stage managers by a feature flag).
- **On stage** when they arrive; **Served** when done.

## Check-in desk
**Check-in desk** finds families by name, phone digits or token, checks them in without a code, and adds walk-ins (they join the back of the queue).

## Clock calibration
The console shows a QR that changes every second. Photographers photograph it with each camera so their photos can be matched to stage calls by time.

## What the TV shows
Only the token now being called, an instruction and the next token. Never names, phones or amounts.
