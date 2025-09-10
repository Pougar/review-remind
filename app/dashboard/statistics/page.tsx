"use client";

import { useEffect, useState } from "react";

type ReviewCounts = {
    good: number;
    bad: number;
    not_reviewed_yet: number;
  };

export default function Stats() {

    const [counts, setCounts] = useState<ReviewCounts | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchCounts() {
          try {
            const res = await fetch("/api/statistics");
            if (!res.ok) throw new Error("Failed to fetch review counts");
            const data: ReviewCounts = await res.json();
            setCounts(data);
          } catch (err: any) {
            setError(err.message);
          } finally {
            setLoading(false);
          }
        }
    
        fetchCounts();
      }, []);
    
      if (loading) return <p>Loading review counts...</p>;
      if (error) return <p>Error: {error}</p>;
    

    return (
      <div className="min-h-screen flex items-center justify-center">
        <h1>Client Reviews</h1>
            <ul>
                <li>Good: {counts?.good}</li>
                <li>Bad: {counts?.bad}</li>
                <li>Not Reviewed Yet: {counts?.not_reviewed_yet}</li>
            </ul>
      </div>
    );
  }
  