// Два модуля используют друг друга: неиспользованного модуля нет.
module ping (input wire a, output wire b);
    pong u (.a(a), .b(b));
endmodule

module pong (input wire a, output wire b);
    ping u (.a(a), .b(b));
endmodule
