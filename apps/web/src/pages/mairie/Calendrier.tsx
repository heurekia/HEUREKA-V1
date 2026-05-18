import { useState } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";

export function Calendrier() {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const startDay = monthStart.getDay();

  const monthName = currentMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));

  const events = [
    { day: 5, title: "Commission urbanisme", type: "reunion" },
    { day: 12, title: "Visite parcelle - DOS-001", type: "visite" },
    { day: 15, title: "Audience publique", type: "audience" },
    { day: 20, title: "Date limite - DOS-003", type: "echeance" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Calendrier</h1>
        <Button>Ajouter un événement</Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={prevMonth}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Button>
            <h3 className="text-lg font-semibold capitalize">{monthName}</h3>
            <Button variant="ghost" onClick={nextMonth}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden">
            {["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"].map((d) => (
              <div key={d} className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 text-center">{d}</div>
            ))}
            {Array.from({ length: startDay }).map((_, i) => (
              <div key={`empty-${i}`} className="bg-white px-3 py-4 min-h-[80px]" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayEvents = events.filter((e) => e.day === day);
              return (
                <div key={day} className="bg-white px-3 py-2 min-h-[80px] text-sm border-t border-gray-100">
                  <span className="text-gray-700 font-medium">{day}</span>
                  {dayEvents.map((e, j) => (
                    <div key={j} className={`mt-1 px-1.5 py-0.5 rounded text-xs truncate ${
                      e.type === "reunion" ? "bg-blue-100 text-blue-700" :
                      e.type === "visite" ? "bg-green-100 text-green-700" :
                      e.type === "audience" ? "bg-purple-100 text-purple-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {e.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
