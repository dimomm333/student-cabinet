"use client";

import Link from "next/link";
import { useState } from "react";
import { lessonDays } from "@/lib/demo-data";
import { Icon } from "./icon";

export function SchedulePreview() {
  const [day, setDay] = useState(0);
  const selected = lessonDays[day];
  return (
    <section className="panel schedule-panel" aria-labelledby="schedule-title">
      <div className="panel-heading">
        <h2 id="schedule-title">Ближайшие занятия</h2>
        <Link href="/dashboard/schedule" className="text-link">
          Всё расписание <Icon name="arrow" size={16} />
        </Link>
      </div>
      <div className="schedule-controls">
        <div className="segmented-control" role="group" aria-label="День занятий">
          {lessonDays.map((item, index) => (
            <button
              key={item.label}
              aria-pressed={day === index}
              onClick={() => setDay(index)}
              className={day === index ? "selected" : ""}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span>{selected.date}</span>
      </div>
      <div aria-live="polite" aria-atomic="true">
        <div className="lesson-list">
          {selected.lessons.map((lesson) => (
            <article key={lesson.title} className="lesson">
              <div className="lesson-time">
                <strong>{lesson.start}</strong><span>{lesson.end}</span>
              </div>
              <span className={`lesson-line ${lesson.tone}`} />
              <div className="lesson-content">
                <div className="lesson-heading">
                  <h3>{lesson.title}</h3>
                  <span className={`lesson-type ${lesson.tone}`}>{lesson.type}</span>
                </div>
                <p>{lesson.teacher}</p>
                <div className="lesson-location">
                  <Icon name="pin" size={14} />
                  <strong>{lesson.room}</strong><span>· {lesson.building}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="schedule-note">
          <Icon name="clock" size={16} />
          <span>{selected.lessons.length} занятия · Время местное · Учебный пример</span>
        </div>
      </div>
    </section>
  );
}
