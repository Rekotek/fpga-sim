// Ожидаемое поведение: led[0] горит, пока нажата кнопка S1, led[1] — пока нажата S2,
// led[2] — пока нажаты обе. led[3..5] погашены. Светодиоды горят при нуле.
// Схема без такта: выходы пересчитываются при изменении входов.
// Кнопки платы замыкают вывод на 3,3 В, поэтому входам нужна подтяжка вниз (PULL_MODE=DOWN).
module top (
    input  wire       btn1,
    input  wire       btn2,
    output wire [5:0] led
);
    assign led[0] = ~btn1;
    assign led[1] = ~btn2;
    assign led[2] = ~(btn1 & btn2);
    assign led[5:3] = 3'b111;
endmodule
