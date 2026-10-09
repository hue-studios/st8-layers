# layers/st8-social

The global ST8 social layer (docs/go-live-plan.md §5): threads, comments, reactions, reports, moderation and
notifications, shared by Insider, Summit and Portal. Every write goes through `server/api/social/*`; Directus
permissions handle visibility.

Empty until Phase 4. Components go in `app/components/social/` (`SocialReactionBar`, `SocialThread`,
`SocialComment`, `SocialComposer`, `SocialReportDialog`, `SocialNotificationBell`) and, like the rest of the app,
compose the shadcn-vue base in the host's `app/components/ui/` without editing it.
