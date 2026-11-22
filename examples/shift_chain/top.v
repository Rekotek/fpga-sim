// Ожидаемое поведение: пока нажата кнопка S1, единица входит в две цепочки из трёх триггеров.
// Цепочки сдвигаются раз в 8 388 608 тактов (0,311 с). В верной цепочке (led[0..2])
// светодиоды загораются по одному, с шагом 0,311 с. В цепочке с ошибкой (led[3..5])
// все три загораются сразу. Светодиоды горят при нуле.
//
// Ошибка — блокирующее «=» в тактовом always модуля chain_bad: строки исполняются
// по порядку, и новое значение q[0] в том же такте доходит до q[2]. Вместо трёх триггеров
// друг за другом получаются три копии одного. Компилятор сообщает об этом: BLKSEQ.
//
// Проверочные числа. Сдвиги идут на тактах 1, 8 388 609, 16 777 217, … (0 с; 0,311 с; 0,621 с).
// Кнопка нажата в момент 0,1 с. В момент 0,8 с: выводы 15 и 16 в нуле (по одному переключению),
// вывод 17 в единице (переключений нет), выводы 18, 19, 20 в нуле (по одному переключению).
module chain_good (
    input  wire       clk,
    input  wire       en,
    input  wire       d,
    output reg  [2:0] q = 3'b000
);
    always @(posedge clk) begin
        if (en) begin
            q[0] <= d;
            q[1] <= q[0];
            q[2] <= q[1];
        end
    end
endmodule

module chain_bad (
    input  wire       clk,
    input  wire       en,
    input  wire       d,
    output reg  [2:0] q = 3'b000
);
    always @(posedge clk) begin
        if (en) begin
            q[0] = d;
            q[1] = q[0];
            q[2] = q[1];
        end
    end
endmodule

module top (
    input  wire       clk,
    input  wire       btn1,
    output wire [5:0] led
);
    reg [22:0] div = 0;
    always @(posedge clk) div <= div + 1'b1;
    wire en = (div == 23'd0);

    wire [2:0] good;
    wire [2:0] bad;

    chain_good u_good (.clk(clk), .en(en), .d(btn1), .q(good));
    chain_bad  u_bad  (.clk(clk), .en(en), .d(btn1), .q(bad));

    assign led = {~bad, ~good};
endmodule
