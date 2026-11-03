const palette = ["coral", "lilac", "mint", "peach", "blue"];

function messageId() {
  return globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createMessage({
  sender,
  senderEmail,
  subject,
  preview,
  body,
  color,
  category = "primary",
  labels = [],
  unread = false,
  starred = false,
  ageMinutes = 0,
}) {
  return {
    id: messageId(),
    sender,
    senderEmail,
    subject,
    preview,
    body,
    color: palette.includes(color) ? color : "lilac",
    category,
    labels,
    unread,
    starred,
    folder: "inbox",
    createdAt: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
    reactions: [],
  };
}

export function createInitialMailbox() {
  return {
    messages: [
      createMessage({
        sender: "Jordan Lee",
        senderEmail: "jordan@beoneofus.com",
        subject: "Community meetup this Friday",
        preview: "Hey Maya! We’re getting everyone together this Friday at the park...",
        body: [
          "Hey Maya,",
          "We’re getting everyone together this Friday at the park, and it wouldn’t be the same without you!",
          "We’ll meet by the big oak tree around 4:30. Bring a snack to share if you can, but mostly just bring yourself. Feel free to share the invite with another BeOneOfUs teammate.",
          "Hope you can make it!",
          "See you soon,\nJordan",
        ],
        color: "coral",
        category: "primary",
        labels: ["Community"],
        starred: true,
        ageMinutes: 18,
      }),
      createMessage({
        sender: "Alex Morgan",
        senderEmail: "alex@beoneofus.com",
        subject: "Photos from the weekend",
        preview: "Finally got around to sorting through the photos — here are my favorites!",
        body: [
          "Hi Maya,",
          "Finally got around to sorting through the photos — here are my favorites! The afternoon turned out so lovely. I’ll share the rest of the album when I have it organized.",
          "Hope your week is off to a good start,\nAlex",
        ],
        color: "lilac",
        category: "social",
        labels: ["Friends"],
        unread: true,
        ageMinutes: 1_440,
      }),
      createMessage({
        sender: "Community Team",
        senderEmail: "admin@beoneofus.com",
        subject: "A little update from us",
        preview: "New faces, familiar friends, and everything happening this month.",
        body: [
          "Hello Maya,",
          "New faces, familiar friends, and lots of good things are happening this month. We’ve added a few new community events to the calendar and would love to see you there.",
          "Take a look when you have a moment, and let us know what you think.\nThe Community Team",
        ],
        color: "mint",
        category: "updates",
        labels: ["Community"],
        unread: true,
        ageMinutes: 2_880,
      }),
      createMessage({
        sender: "Sam Rivera",
        senderEmail: "sam@beoneofus.com",
        subject: "Re: Book club next week",
        preview: "That works perfectly for me. I’ll bring a few snack options!",
        body: [
          "That works perfectly for me. I’ll bring a few snack options!",
          "Looking forward to seeing everyone,\nSam",
        ],
        color: "peach",
        category: "primary",
        labels: ["Friends"],
        ageMinutes: 4_320,
      }),
      createMessage({
        sender: "Taylor Kim",
        senderEmail: "taylor@beoneofus.com",
        subject: "Thanks for having us!",
        preview: "We had such a lovely time. Let’s do it again soon.",
        body: [
          "Hi Maya,",
          "We had such a lovely time. Let’s do it again soon — I’m happy to host next time!",
          "Taylor",
        ],
        color: "blue",
        category: "social",
        labels: ["Friends"],
        ageMinutes: 5_760,
      }),
    ],
    drafts: [],
    labels: [
      { name: "Friends", color: "lilac" },
      { name: "Community", color: "mint" },
    ],
  };
}

export function createId(prefix) {
  return `${prefix}-${messageId()}`;
}
