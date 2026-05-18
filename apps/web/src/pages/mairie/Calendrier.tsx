import { useState } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, MapPin, Users, AlertCircle } from "lucide-react";

const eventIcons: Record<string, any> = {
  reunion: Users,
  visite: MapPin,
  audience: Users,
  echeance: AlertCircle,
};

const eventColors: Record<string, string> = {
  reunion: "bg-blue-100 text-blue-700 border-blue-200",
  visite: "bg-green-100 text-green-700 border-green-200",
  audience: "bg-purple-100 text-purple-700 border-purple-200",
  echeance: "bg-yellow-100 text-yellow-700 border-yellow-200",
};

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
        <div>
          <h1 className="text-2xl font-bold text-[#000020]">Calendrier</h1>
          <p className="text-gray-500 text-sm mt-1">Planification des événements et échéances</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Ajouter un événement
        </Button>
      </div>

      <Card className="border-gray-200/80">
        <CardHeader>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={prevMonth}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <h3 className="text-lg font-semibold text-[#000020] capitalize">{monthName}</h3>
            <Button variant="ghost" size="sm" onClick={nextMonth}>
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden">
            {["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"].map((d) => (
              <div key={d} className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 text-center">{d}</div>
            ))}
            {Array.from({ length: startDay }).map((_, i) => (
              <div key={`empty-${i}`} className="bg-white px-3 py-4 min-h-[90px]" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayEvents = events.filter((e) => e.day === day);
              const isToday = new Date().getDate() === day && new Date().getMonth() === currentMonth.getMonth() && new Date().getFullYear() === currentMonth.getFullYear();
              return (
                <div key={day} className={`bg-white px-3 py-2 min-h-[90px] text-sm border-t border-gray-100 ${isToday ? "ring-2 ring-heureka-500 ring-inset" : ""}`}>
                  <span className={`font-medium ${isToday ? "text-heureka-600" : "text-gray-700"}`}>{day}</span>
                  {dayEvents.map((e, j) => {
                    const EventIcon = eventIcons[e.type] || CalendarDays;
                    return (
                      <div key={j} className={`mt-1 px-1.5 py-0.5 rounded text-xs truncate flex items-center gap-1 ${eventColors[e.type]}`}>
                        <EventIcon className="w-3 h-3 shrink-0" />
                        {e.title}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
