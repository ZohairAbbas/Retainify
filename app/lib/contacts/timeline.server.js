import prisma from "../../db.server.js";
import { normalizeEmail } from "./contacts.server.js";

/**
 * Build a chronological timeline of every signal Retainify has on this contact.
 * Computed on read by UNIONing rows from the five existing tables — no event
 * log. Events are objects of shape { kind, at, payload } sorted desc by at.
 */
export async function buildTimeline(shop, emailRaw) {
  const email = normalizeEmail(emailRaw);
  const [
    carts,
    signups,
    enrollments,
    emailJobs,
    pushJobs,
    suppressions,
    tagApplications,
    pathEvents,
  ] = await Promise.all([
    prisma.abandonedCart.findMany({
      where: { shop, customerEmail: email },
      select: {
        id: true,
        abandonedAt: true,
        recoveredAt: true,
        recoveredRevenue: true,
        totalPrice: true,
        lineItemsJson: true,
      },
      orderBy: { abandonedAt: "desc" },
      take: 50,
    }),
    prisma.popupSignup.findMany({
      where: { shop, email },
      select: { id: true, createdAt: true, confirmedAt: true, source: true },
    }),
    prisma.journeyEnrollment.findMany({
      where: { shop, contactEmail: email },
      select: {
        id: true,
        enrolledAt: true,
        completedAt: true,
        exitReason: true,
        journey: { select: { name: true } },
      },
    }),
    prisma.journeyJob.findMany({
      where: { shop, enrollment: { contactEmail: email } },
      select: {
        id: true,
        sentAt: true,
        openedAt: true,
        clickedAt: true,
        step: { select: { subject: true, journey: { select: { name: true } } } },
      },
      take: 100,
    }),
    prisma.pushJob.findMany({
      where: { shop, enrollment: { contactEmail: email } },
      select: {
        id: true,
        sentAt: true,
        status: true,
        step: { select: { pushTitle: true, pushBody: true } },
      },
      take: 50,
    }),
    prisma.emailSuppression.findMany({
      where: { shop, email },
      select: { id: true, reason: true, createdAt: true },
    }),
    prisma.contactTag.findMany({
      where: { contact: { shop, email } },
      select: {
        createdAt: true,
        // Which flow step applied it, if one did. Null means a person did —
        // and saying so is the point of storing it: "why does this contact
        // have that tag" is otherwise unanswerable.
        appliedByStepKey: true,
        tag: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    // Which way this contact went at each split. The jobs alone cannot answer
    // it: a branch whose side sends nothing leaves no job, and a job that does
    // exist cannot tell "the split said no" from "not reached yet". This is
    // what makes "why did they get that email" answerable without a database
    // session.
    prisma.journeyPathEvent.findMany({
      where: { enrollment: { shop, contactEmail: email } },
      select: {
        id: true,
        branch: true,
        evaluatedAt: true,
        stepId: true,
        enrollment: { select: { journey: { select: { name: true } } } },
      },
      orderBy: { evaluatedAt: "desc" },
      take: 50,
    }),
  ]);

  // Split labels come from the step rows, which the path events reference by
  // id. Looked up separately rather than joined, because a split the merchant
  // has since deleted still has decisions worth showing.
  const splitNames = new Map(
    (
      await prisma.journeyStep.findMany({
        where: { id: { in: [...new Set(pathEvents.map((e) => e.stepId))] } },
        select: { id: true, emailName: true, stepNumber: true },
      })
    ).map((s) => [s.id, s.emailName || `Split ${s.stepNumber}`]),
  );

  const events = [];

  for (const c of carts) {
    let items = "";
    try {
      const parsed = JSON.parse(c.lineItemsJson || "[]");
      if (Array.isArray(parsed) && parsed.length) {
        items = parsed
          .slice(0, 3)
          .map((it) => it.title || it.name || "Item")
          .join(", ");
      }
    } catch {
      // ignore
    }
    events.push({
      kind: "cart_abandoned",
      at: c.abandonedAt,
      payload: { value: c.totalPrice, items },
    });
    if (c.recoveredAt) {
      events.push({
        kind: "cart_recovered",
        at: c.recoveredAt,
        payload: { value: c.recoveredRevenue || c.totalPrice, items },
      });
    }
  }

  for (const s of signups) {
    events.push({
      kind: "signed_up",
      at: s.createdAt,
      payload: { source: s.source },
    });
    if (s.confirmedAt) {
      events.push({
        kind: "confirmed_email",
        at: s.confirmedAt,
        payload: {},
      });
    }
  }

  for (const e of enrollments) {
    events.push({
      kind: "entered_journey",
      at: e.enrolledAt,
      payload: { name: e.journey?.name || "" },
    });
    if (e.completedAt) {
      events.push({
        kind: "exited_journey",
        at: e.completedAt,
        payload: { name: e.journey?.name || "", reason: e.exitReason },
      });
    }
  }

  for (const p of pathEvents) {
    events.push({
      kind: "split_taken",
      at: p.evaluatedAt,
      payload: {
        name: p.enrollment?.journey?.name || "",
        split: splitNames.get(p.stepId) || "Split",
        branch: p.branch,
      },
    });
  }

  for (const j of emailJobs) {
    const subject = j.step?.subject || "";
    const journey = j.step?.journey?.name || "";
    if (j.sentAt) {
      events.push({
        kind: "email_sent",
        at: j.sentAt,
        payload: { subject, journey },
      });
    }
    if (j.openedAt) {
      events.push({
        kind: "email_opened",
        at: j.openedAt,
        payload: { subject, journey },
      });
    }
    if (j.clickedAt) {
      events.push({
        kind: "email_clicked",
        at: j.clickedAt,
        payload: { subject, journey },
      });
    }
  }

  for (const p of pushJobs) {
    if (p.sentAt) {
      events.push({
        kind: "push_sent",
        at: p.sentAt,
        payload: {
          title: p.step?.pushTitle || "",
          body: p.step?.pushBody || "",
        },
      });
    }
  }

  for (const sup of suppressions) {
    const kind =
      sup.reason === "bounce"
        ? "bounced"
        : sup.reason === "complaint"
          ? "complained"
          : "unsubscribed";
    events.push({
      kind,
      at: sup.createdAt,
      payload: { reason: sup.reason },
    });
  }

  // Flow names for tags a flow applied. Looked up by step key rather than
  // joined, because the step row a key points at is recreated on every save
  // and a deleted step still has tags to explain.
  const tagStepKeys = [...new Set(tagApplications.map((t) => t.appliedByStepKey).filter(Boolean))];
  const flowByStepKey = new Map();
  if (tagStepKeys.length) {
    const steps = await prisma.journeyStep.findMany({
      where: { stepKey: { in: tagStepKeys }, journey: { shop } },
      select: { stepKey: true, journey: { select: { name: true } } },
    });
    for (const st of steps) {
      if (!flowByStepKey.has(st.stepKey)) flowByStepKey.set(st.stepKey, st.journey?.name || "");
    }
  }

  for (const t of tagApplications) {
    events.push({
      kind: "tagged",
      at: t.createdAt,
      payload: {
        tag: t.tag.name,
        // Absent for a tag applied by hand, which is the honest reading — the
        // renderer shows nothing rather than guessing at a source.
        byFlow: t.appliedByStepKey ? flowByStepKey.get(t.appliedByStepKey) || "a flow" : null,
      },
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events;
}

/**
 * Tab-specific row builders — separate from timeline so the profile tabs can
 * paginate independently if needed later.
 */
export async function getContactCarts(shop, emailRaw) {
  const email = normalizeEmail(emailRaw);
  const rows = await prisma.abandonedCart.findMany({
    where: { shop, customerEmail: email },
    orderBy: { abandonedAt: "desc" },
    take: 50,
  });
  return rows.map((c) => {
    let items = "";
    try {
      const parsed = JSON.parse(c.lineItemsJson || "[]");
      if (Array.isArray(parsed)) {
        items = parsed
          .slice(0, 3)
          .map((it) => it.title || it.name || "Item")
          .join(", ");
      }
    } catch {
      // ignore
    }
    return {
      id: c.id,
      date: c.abandonedAt,
      items,
      value: c.totalPrice,
      status: c.recoveredAt ? "Recovered" : "Abandoned",
    };
  });
}

export async function getContactEmails(shop, emailRaw) {
  const email = normalizeEmail(emailRaw);
  const jobs = await prisma.journeyJob.findMany({
    where: { shop, sentAt: { not: null }, enrollment: { contactEmail: email } },
    orderBy: { sentAt: "desc" },
    take: 50,
    include: {
      step: { include: { journey: { select: { name: true } } } },
    },
  });
  return jobs.map((j) => ({
    id: j.id,
    date: j.sentAt,
    subject: j.step?.subject || "",
    journey: j.step?.journey?.name || "",
    opened: !!j.openedAt,
    clicked: !!j.clickedAt,
  }));
}

export async function getContactPushes(shop, emailRaw) {
  const email = normalizeEmail(emailRaw);
  const jobs = await prisma.pushJob.findMany({
    where: { shop, enrollment: { contactEmail: email } },
    orderBy: { sentAt: "desc" },
    take: 50,
    include: { step: true },
  });
  return jobs.map((j) => ({
    id: j.id,
    date: j.sentAt || j.createdAt,
    title: j.step?.pushTitle || "",
    body: j.step?.pushBody || "",
    delivered: j.status === "done",
    // Was hardcoded false, which contradicted the "Push clicks" stat card
    // directly above this table on the same page.
    clicked: !!j.clickedAt,
  }));
}

export async function getContactJourneys(shop, emailRaw) {
  const email = normalizeEmail(emailRaw);
  const enrollments = await prisma.journeyEnrollment.findMany({
    where: { shop, contactEmail: email },
    orderBy: { enrolledAt: "desc" },
    include: {
      journey: { select: { name: true } },
      _count: { select: { jobs: true } },
    },
  });
  const active = [];
  let past = 0;
  for (const e of enrollments) {
    if (e.completedAt) {
      past += 1;
    } else {
      active.push({
        name: e.journey?.name || "",
        step: `Step ${e._count.jobs}`,
        startedAt: e.enrolledAt,
      });
    }
  }
  return { active, past };
}
