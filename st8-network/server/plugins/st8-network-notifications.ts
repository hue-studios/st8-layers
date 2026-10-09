// How the bell words and links the notifications this layer writes (st8-social's registerNotificationType).
export default defineNitroPlugin(() => {
  const cfg = () => useSt8Network()
  const profile = (id: string | null | undefined) => (id ? cfg().profilePath(id) : null) ?? cfg().connectionsPath

  registerNotificationType('connection_request', {
    text: () => 'wants to connect',
    link: () => `${cfg().connectionsPath}?tab=requests`,
  })
  registerNotificationType('connection_accepted', {
    text: (n) => (n.data?.via === 'invite' ? 'connected with you through your invite link' : 'accepted your connection request'),
    link: (n) => profile(n.actor),
  })
  registerNotificationType('intro', {
    text: (n) => `introduced you to ${(n.data?.with && n.people.get(n.data.with)?.name) || 'a member'}`,
    link: (n) => profile(n.data?.with),
  })
})
