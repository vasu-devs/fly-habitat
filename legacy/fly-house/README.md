# Fly House

Archived early prototype. This artificial-agent demo is preserved for history and is not the measured-connectome app deployed at the repository root. Its original static files live in `web/` here. Stop other task-owned servers on port 4173 before running this separate demo.

A small browser experiment: Pip is a virtual fly living in a six-room human house.
It chooses activities from its current needs and learned preferences, receives
numeric reward or discouragement, and updates a compact reinforcement-learning
policy. You can save a learned brain, disconnect a deterministic fraction of its
weights, and compare the intact and damaged policies under matched trials.

## Run locally

From this folder:

```powershell
npm start
```

Open <http://127.0.0.1:4173>.

## Controls

- Click a room to suggest an activity immediately.
- Reward or discourage the latest choice to provide a dopamine-like teaching
  signal.
- Toggle learning to freeze or resume weight updates.
- Save a brain checkpoint, move the disconnect slider, and run the comparison.
- Use the speed buttons or pause control to watch the day unfold.

## Scope

This is an intentionally small, inspectable artificial model. It does not load
the MaleCNS or FlyWire connectome, and its dopamine signal is a numerical
reinforcement signal rather than a biochemical simulation. The house effects,
activity choices, and need dynamics are authored so the learning and damage
experiments are easy to see and reproduce.
